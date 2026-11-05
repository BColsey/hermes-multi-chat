#!/usr/bin/env python3
"""Preview-first, dependency-free installer for the Hermes Multi Chat plugin.

Run as the OS user who runs Hermes. No sudo, pip install, auth token, service
restart or model-default change is performed. An installed Hermes Python is
used only for its existing configuration reader/writer.

MIT License

Copyright (c) 2026 BColsey

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import hashlib
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request

VERSION = "0.2.0"
HERMES_VERSION = "0.22.6"
HERMES_COMMIT = "f0d94882e89ab8d4098b5bb2f166adfb9ee0a0ab"
REPOSITORY = "BColsey/hermes-multi-chat"
MAX_BYTES = 8 * 1024 * 1024
REQUIRED = {
    "dashboard/manifest.json",
    "dashboard/plugin_api.py",
    "dashboard/dist/index.js",
    "dashboard/dist/style.css",
}


class InstallError(Exception):
    """A safe, actionable error; never include captured Hermes configuration."""


def change_consent(config, enabled, disabled):
    result = copy.deepcopy(config)
    plugins = result.setdefault("plugins", {})
    if not isinstance(plugins, dict):
        raise InstallError(
            "The plugins config is not a mapping; fix it in Hermes first."
        )
    for key, present in (("enabled", enabled), ("disabled", disabled)):
        values = plugins.get(key, [])
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise InstallError(
                "Plugin consent must be a list of names; no settings were replaced."
            )
        updated = [v for v in values if v != "multi-chat"]
        if present:
            updated.append("multi-chat")
        # Preserve ordering and bytes when an operation is already satisfied.
        if ("multi-chat" in values) == present and values.count("multi-chat") <= 1:
            updated = values
        plugins[key] = updated
    return result


def require_compatible(info):
    if info.get("version") != HERMES_VERSION or info.get("commit") != HERMES_COMMIT:
        raise InstallError(
            f"This preview supports only Hermes {HERMES_VERSION} ({HERMES_COMMIT[:12]}). Nothing was changed."
        )
    if info.get("default_profile") is not True:
        raise InstallError(
            "Only the default Hermes profile is supported. Nothing was changed."
        )
    if info.get("isolation") != "in_process":
        raise InstallError(
            "Multi Chat requires the existing in_process plugin mode. The installer will not change isolation settings."
        )


def hermes_operation(source, home, operation, flags):
    """Runs inside the selected Hermes environment. Never return full config."""
    os.environ["HERMES_HOME"] = str(home)
    os.environ.pop("HERMES_PROFILE", None)
    sys.path.insert(0, str(source))
    from hermes_constants import get_default_hermes_root, get_hermes_home
    from hermes_cli.version_info import get_code_identity
    from hermes_cli.config import atomic_config_write, load_config, read_raw_config

    identity = get_code_identity()
    config = load_config()
    raw = read_raw_config()
    plugins = raw.get("plugins", {})
    if not isinstance(plugins, dict):
        raise InstallError("Invalid plugin consent settings.")
    info = {
        "version": identity.get("version"),
        "commit": identity.get("sha"),
        "default_profile": Path(get_default_hermes_root()).resolve()
        == home
        == Path(get_hermes_home()).resolve(),
        "isolation": (config.get("plugins") or {}).get("isolation", "in_process"),
        "enabled": "multi-chat" in plugins.get("enabled", []),
        "disabled": "multi-chat" in plugins.get("disabled", []),
    }
    require_compatible(info)
    if operation == "consent":
        updated = change_consent(raw, flags["enabled"], flags["disabled"])
        if updated != raw:
            atomic_config_write(home / "config.yaml", updated)
    return info


HELPER = """import json, pathlib, runpy, sys
ns={}
try:
 ns=runpy.run_path(sys.argv[1])
 result=ns['hermes_operation'](pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3]),sys.argv[4],json.loads(sys.argv[5]))
 print(json.dumps(result))
except (Exception, SystemExit) as error:
 message=str(error) if isinstance(error,ns.get('InstallError',type(None))) else 'Hermes inspection/configuration failed; no private config is printed. Check the source, runtime Python and profile.'
 print(json.dumps({'error':message}))
 sys.exit(2)
"""


class Runtime:
    def __init__(self, home, source, python=None):
        self.home, self.source = home.resolve(), source.resolve()
        if not (self.home / "config.yaml").is_file():
            raise InstallError(
                "Initialize Hermes first: the selected home has no config.yaml."
            )
        if (self.home / "config.yaml").is_symlink():
            raise InstallError(
                "Refusing to change a symlinked config.yaml. Use the manual install guide."
            )
        if not (self.source / "hermes_cli/web_server.py").is_file():
            raise InstallError(
                "Hermes source not found. Pass --hermes-source with your installed source directory."
            )
        self.env = os.environ.copy()
        self.env["HERMES_HOME"] = str(self.home)
        self.env.pop("HERMES_PROFILE", None)
        if python:
            self.python = str(python)
        else:
            probe = "import pathlib,sys;sys.path.insert(0,sys.argv[1]);from pm.environments import project_python;print(project_python(pathlib.Path(sys.argv[1])))"
            result = subprocess.run(
                [sys.executable, "-I", "-c", probe, str(self.source)],
                env=self.env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode:
                raise InstallError(
                    "Cannot locate Hermes's existing Python. Pass --python; no dependencies will be installed."
                )
            self.python = result.stdout.strip()
        if not Path(self.python).is_file():
            raise InstallError(
                "The selected Hermes Python does not exist. Pass --python or repair Hermes separately."
            )

    def _call(self, operation, flags=None):
        command = [
            self.python,
            "-c",
            HELPER,
            str(Path(__file__).resolve()),
            str(self.source),
            str(self.home),
            operation,
            json.dumps(flags or {}),
        ]
        result = subprocess.run(
            command, env=self.env, capture_output=True, text=True, timeout=30
        )
        try:
            info = json.loads(result.stdout.strip())
        except ValueError:
            raise InstallError(
                "Hermes did not return a safe inspection result. Check --python; no captured output is printed."
            ) from None
        if result.returncode or "error" in info:
            raise InstallError(
                info.get(
                    "error",
                    "Hermes inspection failed; check --python. No private config is printed.",
                )
            )
        require_compatible(info)
        return info

    def inspect(self):
        return self._call("inspect")

    def consent(self, enabled, disabled):
        self._call("consent", {"enabled": enabled, "disabled": disabled})


def parse_checksum(text, filename):
    match = re.fullmatch(r"([a-fA-F0-9]{64})\s+\*?([^/\\\n]+)\s*", text.strip())
    if not match or match[2] != filename:
        raise InstallError(
            "Invalid checksum file or filename mismatch. Nothing was installed."
        )
    return match[1].lower()


def verify_bundle(bundle):
    checksum = bundle.with_name(bundle.name + ".sha256")
    if not checksum.is_file():
        raise InstallError("The matching .sha256 file is required beside the bundle.")
    expected = parse_checksum(checksum.read_text(), bundle.name)
    if (
        bundle.stat().st_size > MAX_BYTES
        or hashlib.sha256(bundle.read_bytes()).hexdigest() != expected
    ):
        raise InstallError(
            "Bundle checksum/size verification failed. Nothing was installed."
        )


def valid_manifest(path, exact_version=True):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        raise InstallError(
            "Missing or unreadable Multi Chat dashboard manifest."
        ) from None
    if (
        value.get("name") != "multi-chat"
        or value.get("tab", {}).get("path") != "/multi-chat"
        or value.get("tab", {}).get("override")
    ):
        raise InstallError(
            "Refusing a manifest that does not describe the separate Multi Chat route."
        )
    if exact_version and (
        value.get("version") != VERSION
        or value.get("entry") != "dist/index.js"
        or value.get("css") != "dist/style.css"
        or value.get("api") != "plugin_api.py"
    ):
        raise InstallError(
            "Bundle and installer versions/contracts do not match. Download both from the same release."
        )
    return value


def extract_bundle(bundle, stage):
    files = {}
    if bundle.stat().st_size > MAX_BYTES:
        raise InstallError("Compressed archive exceeds the size limit.")
    with gzip.open(bundle, "rb") as compressed:
        data = compressed.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise InstallError("Decompressed archive exceeds the size limit.")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
        for index, member in enumerate(archive):
            if index >= 64:
                raise InstallError("Too many archive members.")
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or member.name.rstrip("/") != str(path)
                or not path.parts
                or path.parts[0] != "multi-chat"
            ):
                raise InstallError("Unsafe archive path.")
            relative = str(path.relative_to("multi-chat"))
            directories = {
                ".",
                "dashboard",
                "dashboard/dist",
                "dashboard/dist/licenses",
            }
            if member.isdir() and relative in directories:
                continue
            allowed = (
                relative in REQUIRED
                or relative == "dashboard/dist/build-meta.json"
                or bool(
                    re.fullmatch(r"dashboard/dist/licenses/[a-z0-9-]+\.txt", relative)
                )
            )
            if (
                not member.isfile()
                or not allowed
                or relative in files
                or member.size < 0
                or sum(len(v) for v in files.values()) + member.size > MAX_BYTES
            ):
                raise InstallError(
                    "Unexpected, linked, duplicate or oversized archive member."
                )
            files[relative] = archive.extractfile(member).read()
    if not REQUIRED.issubset(files):
        raise InstallError("The bundle is incomplete.")
    plugin = stage / "multi-chat"
    for relative, data in files.items():
        target = plugin / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    valid_manifest(plugin / "dashboard/manifest.json")
    return plugin


def safe_paths(home):
    for path in [
        home / "plugins",
        home / "plugins/multi-chat",
        home / "plugin-backups",
        home / "plugin-backups/multi-chat",
    ]:
        if path.is_symlink():
            raise InstallError(
                "Refusing symlinked plugin/backup paths. Inspect them before a manual installation."
            )
    if home.exists() and home.stat().st_uid != os.geteuid():
        raise InstallError(
            "Run as the OS user who owns the Hermes profile, not with sudo."
        )


@contextmanager
def profile_lock(home):
    import fcntl

    safe_paths(home)
    home.mkdir(parents=True, exist_ok=True)
    with (home / ".multi-chat-install.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InstallError("Another Multi Chat installer is running.") from None
        yield


def backup_plugin(runtime, action, info):
    root = runtime.home / "plugin-backups/multi-chat"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = root / (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        + "-"
        + secrets.token_hex(4)
    )
    backup.mkdir(mode=0o700)
    (backup / "receipt.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "home": str(runtime.home.resolve()),
                "action": action,
                "enabled": bool(info.get("enabled")),
                "disabled": bool(info.get("disabled")),
            },
            indent=2,
        )
        + "\n"
    )
    (runtime.home / "plugins/multi-chat").rename(backup / "plugin")
    return backup


def replace_plugin(runtime, prepared, info, action, desired):
    destination = runtime.home / "plugins/multi-chat"
    safe_paths(runtime.home)
    if destination.exists():
        valid_manifest(destination / "dashboard/manifest.json", exact_version=False)
    backup = None
    with profile_lock(runtime.home):
        destination.parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(
            prefix=".multi-chat-stage-", dir=destination.parent
        ) as folder:
            staged = Path(folder) / "multi-chat"
            shutil.copytree(prepared, staged)
            new_installed = False
            try:
                if destination.exists():
                    runtime.consent(False, True)
                    backup = backup_plugin(runtime, action, info)
                staged.rename(destination)
                new_installed = True
                runtime.consent(*desired)
            except Exception as error:
                if new_installed and destination.exists():
                    # Preserve even failed new files outside discovery; never delete user data.
                    backup_plugin(
                        runtime,
                        "failed-" + action,
                        {"enabled": False, "disabled": True},
                    )
                if backup and (backup / "plugin").exists():
                    (backup / "plugin").rename(destination)
                try:
                    runtime.consent(
                        bool(info.get("enabled")), bool(info.get("disabled"))
                    )
                except Exception:
                    raise InstallError(
                        "Configuration recovery needs attention; plugin files/backups were preserved. Inspect the profile before retrying."
                    ) from None
                raise InstallError(
                    "Installation failed; previous plugin files and consent were restored."
                ) from error
    return {
        "applied": True,
        "action": action,
        "destination": str(destination),
        "backup": str(backup) if backup else None,
        "restart_may_be_needed": action != "install",
    }


def install_bundle(runtime, bundle, *, apply=False, update=False, acknowledge=False):
    info = runtime.inspect()
    require_compatible(info)
    safe_paths(runtime.home)
    exists = (runtime.home / "plugins/multi-chat").exists()
    if exists != update:
        raise InstallError(
            "Use update for an existing plugin, or install for a new one."
        )
    verify_bundle(bundle)
    with tempfile.TemporaryDirectory(prefix="multi-chat-verify-") as folder:
        prepared = extract_bundle(bundle, Path(folder))
        if not apply:
            return {
                "applied": False,
                "action": "update" if update else "install",
                "destination": str(runtime.home / "plugins/multi-chat"),
                "bundle_verified": True,
            }
        if update and not acknowledge:
            raise InstallError(
                "Account for active work first, then add --acknowledge-active-work. No service will be restarted."
            )
        desired = (
            (bool(info.get("enabled")), bool(info.get("disabled")))
            if update
            else (True, False)
        )
        return replace_plugin(
            runtime, prepared, info, "update" if update else "install", desired
        )


def selected_backup(home, path=None):
    root = home / "plugin-backups/multi-chat"
    candidates = [path] if path else sorted(root.glob("*"), reverse=True)
    for candidate in candidates:
        if (
            not candidate
            or candidate.is_symlink()
            or not candidate.resolve().is_relative_to(root.resolve())
        ):
            raise InstallError(
                "Backup must be inside this profile's Multi Chat backup directory."
            )
        if not (candidate / "plugin/dashboard/manifest.json").is_file():
            continue
        try:
            receipt = json.loads((candidate / "receipt.json").read_text())
        except (OSError, ValueError):
            raise InstallError("Invalid backup receipt.") from None
        if str(receipt.get("action", "")).startswith("failed-"):
            if path:
                raise InstallError(
                    "This is a failed-operation archive, not a completed backup."
                )
            continue
        if receipt.get("schema") != 1 or receipt.get("home") != str(home.resolve()):
            raise InstallError("Backup belongs to a different profile.")
        valid_manifest(
            candidate / "plugin/dashboard/manifest.json", exact_version=False
        )
        return candidate, receipt
    raise InstallError("No restorable Multi Chat backup exists in this profile.")


def manage(runtime, action, *, apply=False, acknowledge=False, backup=None):
    info = runtime.inspect()
    require_compatible(info)
    safe_paths(runtime.home)
    destination = runtime.home / "plugins/multi-chat"
    if action == "doctor":
        return {
            "applied": False,
            "action": action,
            "compatible": True,
            "installed": destination.is_dir(),
            "enabled": bool(info.get("enabled")) and not info.get("disabled"),
            "home": str(runtime.home),
            "runtime_python": getattr(runtime, "python", None),
        }
    if action == "rollback":
        saved, receipt = selected_backup(runtime.home, backup)
        if not apply:
            return {"applied": False, "action": action, "backup": str(saved)}
        if not acknowledge:
            raise InstallError(
                "Account for active work first, then add --acknowledge-active-work."
            )
        return replace_plugin(
            runtime,
            saved / "plugin",
            info,
            action,
            (bool(receipt.get("enabled")), bool(receipt.get("disabled"))),
        )
    if not destination.is_dir():
        raise InstallError("Multi Chat is not installed in this profile.")
    valid_manifest(destination / "dashboard/manifest.json", exact_version=False)
    if not apply:
        return {"applied": False, "action": action, "destination": str(destination)}
    if action != "enable" and not acknowledge:
        raise InstallError(
            "Account for active work first, then add --acknowledge-active-work. Detach is not stop."
        )
    with profile_lock(runtime.home):
        runtime.consent(action == "enable", action != "enable")
        saved = None
        if action == "uninstall":
            try:
                saved = backup_plugin(runtime, action, info)
            except Exception:
                runtime.consent(bool(info.get("enabled")), bool(info.get("disabled")))
                raise
    return {
        "applied": True,
        "action": action,
        "destination": str(destination),
        "backup": str(saved) if saved else None,
    }


class HTTPSRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise InstallError("Refusing an insecure release redirect.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_release(folder):
    name = f"multi-chat-{VERSION}.tar.gz"
    base = f"https://github.com/{REPOSITORY}/releases/download/v{VERSION}/"
    opener = urllib.request.build_opener(HTTPSRedirects())
    for filename in (name, name + ".sha256"):
        request = urllib.request.Request(
            base + filename,
            headers={"User-Agent": f"hermes-multi-chat-installer/{VERSION}"},
        )
        with opener.open(request, timeout=30) as response:
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise InstallError("Release download exceeds the size limit.")
        (folder / filename).write_bytes(data)
    return folder / name


def main():
    parser = argparse.ArgumentParser(
        description=f"Multi Chat {VERSION}: preview-first install and rollback. No services are restarted."
    )
    parser.add_argument("--version", action="version", version=VERSION)
    parser.add_argument(
        "action",
        choices=[
            "doctor",
            "install",
            "update",
            "enable",
            "disable",
            "uninstall",
            "rollback",
        ],
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes"),
        help="default-profile Hermes home (default: HERMES_HOME or ~/.hermes)",
    )
    parser.add_argument(
        "--hermes-source",
        type=Path,
        help="installed Hermes source (default: <home>/hermes-agent)",
    )
    parser.add_argument(
        "--python",
        type=Path,
        help="existing Hermes runtime Python; auto-detected without installing packages",
    )
    parser.add_argument(
        "--bundle",
        type=Path,
        help="local release .tar.gz with its .sha256 file; otherwise fetch this pinned release",
    )
    parser.add_argument(
        "--backup",
        type=Path,
        help="rollback backup path; default: most recent restorable backup",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print only the machine-readable result (local paths included)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="make the previewed changes (default is a dry run)",
    )
    parser.add_argument(
        "--acknowledge-active-work",
        action="store_true",
        help="confirm views/work are accounted for before update/disable/uninstall/rollback",
    )
    args = parser.parse_args()
    if os.name != "posix":
        parser.error(
            "The dashboard PTY and this installer require a POSIX server (Linux/macOS/WSL)."
        )
    if os.environ.get("HERMES_PROFILE", "").lower() not in ("", "default", "current"):
        parser.error(
            "Unset the named HERMES_PROFILE and select the default home explicitly."
        )
    try:
        home = args.home.expanduser().resolve()
        runtime = Runtime(
            home,
            (args.hermes_source or home / "hermes-agent").expanduser(),
            args.python,
        )
        if args.action in ("install", "update"):
            require_compatible(runtime.inspect())
            with tempfile.TemporaryDirectory(prefix="multi-chat-download-") as folder:
                result = install_bundle(
                    runtime,
                    args.bundle.expanduser().resolve()
                    if args.bundle
                    else download_release(Path(folder)),
                    apply=args.apply,
                    update=args.action == "update",
                    acknowledge=args.acknowledge_active_work,
                )
        else:
            result = manage(
                runtime,
                args.action,
                apply=args.apply,
                acknowledge=args.acknowledge_active_work,
                backup=args.backup,
            )
        if args.json:
            print(json.dumps(result, indent=2))
            return 0
        print(
            f"Multi Chat {VERSION} — {args.action}"
            + ("" if result["applied"] else " (preview)")
        )
        print(
            f"Compatible: Hermes {HERMES_VERSION}, default profile, in_process plugins"
        )
        print("Target: " + str(runtime.home / "plugins/multi-chat"))
        if result.get("bundle_verified") or args.action in ("install", "update"):
            print("Bundle: SHA-256 verified")
        if result.get("backup"):
            print("Backup: " + result["backup"])
        if args.action == "doctor":
            print("Installed: " + ("yes" if result["installed"] else "no"))
            print("Enabled: " + ("yes" if result["enabled"] else "no"))
        if result["applied"]:
            print(
                "Done. In Hermes: Plugins → Rescan dashboard extensions, then reload the page."
            )
            print(
                "No service was restarted. History, auth, model defaults and other plugins were not changed."
            )
            if result.get("restart_may_be_needed"):
                print(
                    "Updated Python routes may need a separately planned idle-dashboard restart; never restart active work automatically."
                )
        elif args.action != "doctor":
            print(
                "Preview only: no profile files or settings changed. Review, then repeat with --apply."
            )
        return 0
    except (
        InstallError,
        OSError,
        ValueError,
        tarfile.TarError,
        subprocess.SubprocessError,
        urllib.error.URLError,
    ) as error:
        print(f"Multi Chat: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
