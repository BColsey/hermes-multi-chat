import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  constants,
  openSync,
  fstatSync,
  closeSync,
  ftruncateSync,
} from "node:fs";
import { dirname, join } from "node:path";

if (typeof constants.O_NOFOLLOW !== "number")
  throw new Error(
    "Catalog builds require no-follow file opens on this platform.",
  );
function readRegular(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    if (!fstatSync(fd).isFile())
      throw new Error(`Not a regular catalog input: ${path}`);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeRegular(path, data) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o644,
  );
  try {
    if (!fstatSync(fd).isFile())
      throw new Error(`Not a regular catalog output: ${path}`);
    ftruncateSync(fd, 0);
    writeFileSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check"))
  throw new Error("Usage: node scripts/catalog.mjs [--check]");
const version = JSON.parse(
  readRegular("package.json").toString("utf8"),
).version;
const manifest = JSON.parse(
  readRegular("dashboard/manifest.json").toString("utf8"),
);
if (
  !/^\d+\.\d+\.\d+$/.test(version) ||
  manifest.version !== version ||
  manifest.name !== "multi-chat"
)
  throw new Error(
    "Package and dashboard versions must match before building the catalog package.",
  );

const runtime = [
  "manifest.json",
  "plugin_api.py",
  "dist/index.js",
  "dist/style.css",
  ...["multi-chat", "xterm", "addon-fit", "addon-unicode11"].map(
    (name) => `dist/licenses/${name}.txt`,
  ),
];
// Read all inputs before replacing output; build metadata and the installer are not runtime.
const outputs = new Map(
  runtime.map((path) => [
    "catalog/dashboard/" + path,
    readRegular("dashboard/" + path),
  ]),
);
outputs.set("catalog/LICENSE", readRegular("LICENSE"));
outputs.set(
  "catalog/plugin.yaml",
  Buffer.from(`manifest_version: 1
name: multi-chat
version: "${version}"
description: "Independent real-TUI conversations in the Hermes Web Dashboard."
author: BColsey
license: MIT
kind: standalone
requires_hermes: ">=0.22.6,<0.22.7"
provides_tools: []
provides_hooks: []
provides_middleware: []
requires_env: []
`),
);

function files(directory) {
  if (!lstatSync(directory).isDirectory())
    throw new Error("Catalog output must be a real directory.");
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new Error(`Catalog package contains a non-regular entry: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const expected = new Set([
  ...outputs.keys(),
  "catalog/README.md",
  "catalog/__init__.py",
]);
for (const path of files("catalog"))
  if (!expected.has(path)) throw new Error(`Unexpected catalog file: ${path}`);
if (!check)
  for (const [path, data] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeRegular(path, data);
  }
for (const path of expected) {
  const data = readRegular(path);
  if (outputs.has(path) && !data.equals(outputs.get(path)))
    throw new Error(`Stale catalog file: ${path}; run npm run catalog.`);
}
console.log(
  `Catalog package ${check ? "verified" : "built"}: ${expected.size} files, unchanged runtime, no installer or development payload.`,
);
