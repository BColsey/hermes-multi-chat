import { test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("publication check refuses a file swapped for a symlink before reading it", () => {
  const root = mkdtempSync(resolve(tmpdir(), "multi-chat-public-check-"));
  const repo = resolve(root, "repo");
  const secret = "PUBLICATION_TEST_PRIVATE_SENTINEL";
  mkdirSync(repo);
  execFileSync("git", ["init", "--quiet", repo]);
  writeFileSync(resolve(repo, "README.md"), "# Public fixture\n");
  const outside = resolve(root, "outside.md");
  writeFileSync(outside, secret);
  const preload = resolve(root, "swap.mjs");
  writeFileSync(
    preload,
    `
import { createRequire, syncBuiltinESMExports } from "node:module";
const fs = createRequire(import.meta.url)("node:fs");
let swapped = false;
function swap(path) {
  if (path !== "README.md" || swapped) return;
  swapped = true;
  fs.renameSync(path, "old-readme");
  fs.symlinkSync(process.env.PRIVATE_FIXTURE, path);
}
const stat = fs.lstatSync;
fs.lstatSync = (path, ...args) => { const result = stat(path, ...args); swap(path); return result; };
const open = fs.openSync;
fs.openSync = (path, ...args) => { swap(path); return open(path, ...args); };
syncBuiltinESMExports();
`,
  );
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", preload, resolve("scripts/check-public.mjs")],
      {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PRIVATE_FIXTURE: outside,
          PUBLICATION_TEST_SECRET: secret,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not a readable regular file");
    expect(result.stderr).not.toContain("private guard value found");
    expect(result.stdout + result.stderr).not.toContain(secret);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
