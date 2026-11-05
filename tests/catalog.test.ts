import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const script = resolve("scripts/catalog.py");
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "multi-chat-catalog-"));
  mkdirSync(resolve(root, "dashboard/dist/licenses"), { recursive: true });
  mkdirSync(resolve(root, "catalog"));
  writeFileSync(
    resolve(root, "package.json"),
    JSON.stringify({ version: "0.2.0" }),
  );
  writeFileSync(resolve(root, "LICENSE"), "Project MIT notice\n");
  writeFileSync(resolve(root, "catalog/README.md"), "# Catalog fixture\n");
  writeFileSync(
    resolve(root, "catalog/__init__.py"),
    "def register(ctx):\n    pass\n",
  );
  const files = {
    "manifest.json": JSON.stringify({ name: "multi-chat", version: "0.2.0" }),
    "plugin_api.py": "# Read-only API fixture\n",
    "dist/index.js": "/* Local runtime fixture */\n",
    "dist/style.css": ".mc-root {}\n",
    "dist/licenses/multi-chat.txt": "Project MIT notice\n",
    "dist/licenses/xterm.txt": "xterm notice\n",
    "dist/licenses/addon-fit.txt": "fit notice\n",
    "dist/licenses/addon-unicode11.txt": "Unicode notice\n",
  };
  for (const [path, content] of Object.entries(files))
    writeFileSync(resolve(root, "dashboard", path), content);
  writeFileSync(
    resolve(root, "dashboard/dist/build-meta.json"),
    "private build fixture",
  );
  return { root, files };
}
function run(root: string, check = false) {
  return spawnSync("python3", [script, ...(check ? ["--check"] : [])], {
    cwd: root,
    encoding: "utf8",
  });
}

test("catalog build copies only the exact runtime and notices, with bounded compatibility", () => {
  const f = fixture();
  try {
    expect(run(f.root).status).toBe(0);
    for (const [path, content] of Object.entries(f.files))
      expect(
        readFileSync(resolve(f.root, "catalog/dashboard", path), "utf8"),
      ).toBe(content);
    const manifest = readFileSync(
      resolve(f.root, "catalog/plugin.yaml"),
      "utf8",
    );
    expect(manifest).toContain("name: multi-chat");
    expect(manifest).toContain('version: "0.2.0"');
    expect(manifest).toContain('requires_hermes: ">=0.22.6,<0.22.7"');
    expect(manifest).toContain("provides_tools: []");
    expect(manifest).toContain("requires_env: []");
    expect(readdirSync(resolve(f.root, "catalog")).sort()).toEqual([
      "LICENSE",
      "README.md",
      "__init__.py",
      "dashboard",
      "plugin.yaml",
    ]);
    expect(
      readdirSync(resolve(f.root, "catalog/dashboard/dist")).sort(),
    ).toEqual(["index.js", "licenses", "style.css"]);
    expect(run(f.root, true).status).toBe(0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("catalog check refuses stale assets and unexpected files without repairing them", () => {
  const f = fixture();
  try {
    expect(run(f.root).status).toBe(0);
    const asset = resolve(f.root, "catalog/dashboard/dist/index.js");
    writeFileSync(asset, "stale");
    expect(run(f.root, true).status).toBe(1);
    expect(readFileSync(asset, "utf8")).toBe("stale");
    expect(run(f.root).status).toBe(0);
    writeFileSync(
      resolve(f.root, "catalog/unexpected.txt"),
      "not a package input",
    );
    expect(run(f.root, true).status).toBe(1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("catalog build refuses mismatched versions before replacing generated files", () => {
  const f = fixture();
  try {
    expect(run(f.root).status).toBe(0);
    const asset = resolve(f.root, "catalog/dashboard/dist/index.js");
    writeFileSync(
      resolve(f.root, "dashboard/manifest.json"),
      JSON.stringify({ name: "multi-chat", version: "9.0.0" }),
    );
    expect(run(f.root).status).toBe(1);
    expect(readFileSync(asset, "utf8")).toBe(f.files["dist/index.js"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

function swapRun(
  f: ReturnType<typeof fixture>,
  kind: "read" | "write" | "parent",
) {
  const outside = resolve(
    f.root,
    kind === "parent" ? "outside-dir" : "outside.js",
  );
  const sentinel =
    kind === "read"
      ? f.files["dist/index.js"]
      : "outside fixture must not change";
  if (kind === "parent") mkdirSync(outside);
  const target = kind === "parent" ? resolve(outside, "index.js") : outside;
  writeFileSync(target, sentinel);
  const preload = resolve(f.root, "swap.py");
  writeFileSync(
    preload,
    `
import os, runpy, sys
source = sys.argv[1]
sys.argv = [source] + sys.argv[2:]
original_open = os.open
target_inode = os.stat("catalog/dashboard/dist").st_ino
swapped = False
def open_with_swap(path, flags, *args, **kwargs):
    global swapped
    fd = kwargs.get("dir_fd")
    if path == "index.js" and fd is not None and os.fstat(fd).st_ino == target_inode and not swapped:
        swapped = True
        with open("swap-fired", "w") as marker:
            marker.write(os.environ["SWAP_KIND"])
        if os.environ["SWAP_KIND"] == "parent":
            os.rename("catalog/dashboard/dist", "catalog/dashboard/dist.old")
            os.symlink(os.environ["OUTSIDE_FIXTURE"], "catalog/dashboard/dist")
        else:
            os.rename("catalog/dashboard/dist/index.js", "catalog/dashboard/dist/index.js.old")
            os.symlink(os.environ["OUTSIDE_FIXTURE"], "catalog/dashboard/dist/index.js")
    return original_open(path, flags, *args, **kwargs)
os.open = open_with_swap
os.supports_dir_fd.add(open_with_swap)
runpy.run_path(source, run_name="__main__")
`,
  );
  const result = spawnSync(
    "python3",
    [preload, script, ...(kind === "read" ? ["--check"] : [])],
    {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, OUTSIDE_FIXTURE: outside, SWAP_KIND: kind },
    },
  );
  expect(result.status).toBe(1);
  expect(readFileSync(resolve(f.root, "swap-fired"), "utf8")).toBe(kind);
  expect(readFileSync(target, "utf8")).toBe(sentinel);
}

for (const kind of ["read", "write", "parent"] as const)
  test(`catalog ${kind} path swap cannot read or overwrite an outside fixture`, () => {
    const f = fixture();
    try {
      expect(run(f.root).status).toBe(0);
      swapRun(f, kind);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });

test("new generated files and directories stay private with a permissive caller umask", () => {
  const f = fixture();
  try {
    const result = spawnSync(
      "python3",
      [
        "-c",
        "import os,runpy,sys; os.umask(0); p=sys.argv[1]; sys.argv=[p]; runpy.run_path(p,run_name='__main__')",
        script,
      ],
      {
        cwd: f.root,
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect
      .soft(statSync(resolve(f.root, "catalog/dashboard/dist")).mode & 0o077)
      .toBe(0);
    expect
      .soft(
        statSync(resolve(f.root, "catalog/dashboard/dist/index.js")).mode &
          0o077,
      )
      .toBe(0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
