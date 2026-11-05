import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const script = resolve("scripts/catalog.mjs");
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
  return spawnSync(process.execPath, [script, ...(check ? ["--check"] : [])], {
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

test("catalog check refuses an output swapped for a symlink before reading", () => {
  const f = fixture();
  try {
    expect(run(f.root).status).toBe(0);
    const outside = resolve(f.root, "outside.js");
    writeFileSync(outside, f.files["dist/index.js"]);
    const preload = resolve(f.root, "swap.mjs");
    writeFileSync(
      preload,
      `
import { createRequire, syncBuiltinESMExports } from "node:module";
const fs = createRequire(import.meta.url)("node:fs");
let swapped = false;
function swap(path) {
  if (path !== "catalog/dashboard/dist/index.js" || swapped) return;
  swapped = true;
  fs.renameSync(path, path + ".old");
  fs.symlinkSync(process.env.OUTSIDE_FIXTURE, path);
}
const stat = fs.lstatSync;
fs.lstatSync = (path, ...args) => { const value = stat(path, ...args); swap(path); return value; };
const open = fs.openSync;
fs.openSync = (path, ...args) => { swap(path); return open(path, ...args); };
syncBuiltinESMExports();
`,
    );
    const result = spawnSync(
      process.execPath,
      ["--import", preload, script, "--check"],
      {
        cwd: f.root,
        encoding: "utf8",
        env: { ...process.env, OUTSIDE_FIXTURE: outside },
      },
    );
    expect(result.status).toBe(1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("catalog build never writes through an output swapped for a symlink", () => {
  const f = fixture();
  try {
    expect(run(f.root).status).toBe(0);
    const outside = resolve(f.root, "outside.js");
    const sentinel = "outside fixture must not change";
    writeFileSync(outside, sentinel);
    const preload = resolve(f.root, "swap-write.mjs");
    writeFileSync(
      preload,
      `
import { createRequire, syncBuiltinESMExports } from "node:module";
const fs = createRequire(import.meta.url)("node:fs");
let swapped = false;
function swap(path) {
  if (path !== "catalog/dashboard/dist/index.js" || swapped) return;
  swapped = true;
  fs.renameSync(path, path + ".old");
  fs.symlinkSync(process.env.OUTSIDE_FIXTURE, path);
}
const write = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => { swap(path); return write(path, ...args); };
const open = fs.openSync;
fs.openSync = (path, ...args) => { swap(path); return open(path, ...args); };
syncBuiltinESMExports();
`,
    );
    const result = spawnSync(process.execPath, ["--import", preload, script], {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, OUTSIDE_FIXTURE: outside },
    });
    expect(result.status).toBe(1);
    expect(readFileSync(outside, "utf8")).toBe(sentinel);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
