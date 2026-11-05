"""Build/check the catalog payload with directory-relative, no-follow file access."""

import argparse
from contextlib import contextmanager
import json
import os
import re
import stat


@contextmanager
def parent_fd(root, path, create=False):
    fd = os.dup(root)
    try:
        parts = path.split("/")
        for name in parts[:-1]:
            if create:
                try:
                    os.mkdir(name, dir_fd=fd)
                except FileExistsError:
                    pass
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            os.close(fd)
            fd = child
        yield fd, parts[-1]
    finally:
        os.close(fd)


@contextmanager
def regular_fd(root, path, write=False):
    with parent_fd(root, path, create=write) as (parent, name):
        flags = os.O_WRONLY | os.O_CREAT if write else os.O_RDONLY
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o644, dir_fd=parent)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError(f"Not a regular catalog file: {path}")
            yield fd
        finally:
            os.close(fd)


def read_file(root, path):
    with regular_fd(root, path) as fd, os.fdopen(fd, "rb", closefd=False) as stream:
        return stream.read()


def write_file(root, path, data):
    with regular_fd(root, path, write=True) as fd:
        os.ftruncate(fd, 0)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)


def package_files(fd, prefix):
    result = set()
    for name in os.listdir(fd):
        path = prefix + "/" + name
        mode = os.stat(name, dir_fd=fd, follow_symlinks=False).st_mode
        if stat.S_ISDIR(mode):
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            try:
                result.update(package_files(child, path))
            finally:
                os.close(child)
        elif stat.S_ISREG(mode):
            result.add(path)
        else:
            raise ValueError(f"Non-regular catalog entry: {path}")
    return result


def build(root, check):
    version = json.loads(read_file(root, "package.json"))["version"]
    manifest = json.loads(read_file(root, "dashboard/manifest.json"))
    if (
        not isinstance(version, str)
        or not re.fullmatch(r"\d+\.\d+\.\d+", version)
        or manifest.get("version") != version
        or manifest.get("name") != "multi-chat"
    ):
        raise ValueError("Package and dashboard versions must match.")
    runtime = [
        "manifest.json",
        "plugin_api.py",
        "dist/index.js",
        "dist/style.css",
        *[
            f"dist/licenses/{name}.txt"
            for name in ("multi-chat", "xterm", "addon-fit", "addon-unicode11")
        ],
    ]
    # Preload all inputs before writing; omit the installer and build metadata.
    outputs = {
        "catalog/dashboard/" + path: read_file(root, "dashboard/" + path)
        for path in runtime
    }
    outputs["catalog/LICENSE"] = read_file(root, "LICENSE")
    outputs["catalog/plugin.yaml"] = f"""manifest_version: 1
name: multi-chat
version: "{version}"
description: "Independent real-TUI conversations in the Hermes Web Dashboard."
author: BColsey
license: MIT
kind: standalone
requires_hermes: ">=0.22.6,<0.22.7"
provides_tools: []
provides_hooks: []
provides_middleware: []
requires_env: []
""".encode()
    expected = set(outputs) | {"catalog/README.md", "catalog/__init__.py"}
    directory = os.open(
        "catalog", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root
    )
    try:
        extra = package_files(directory, "catalog") - expected
    finally:
        os.close(directory)
    if extra:
        raise ValueError(f"Unexpected catalog files: {', '.join(sorted(extra))}")
    if not check:
        for path, data in outputs.items():
            write_file(root, path, data)
    for path in expected:
        data = read_file(root, path)
        if path in outputs and data != outputs[path]:
            raise ValueError(f"Stale catalog file: {path}; run npm run catalog.")
    print(
        f"Catalog package {'verified' if check else 'built'}: {len(expected)} files, "
        "unchanged runtime, no installer or development payload."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
        parser.error("Catalog builds require POSIX directory-relative no-follow I/O.")
    root = os.open(".", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        build(root, args.check)
    finally:
        os.close(root)


if __name__ == "__main__":
    main()
