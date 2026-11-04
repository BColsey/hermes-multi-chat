import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

// Read only explicit release files and the lockfile, never crawl local state.
const source = resolve(process.argv[2] || ".");
const assets = resolve(process.argv[3] || "artifacts");
const pkg = JSON.parse(readFileSync(resolve(source, "package.json"), "utf8"));
const lock = JSON.parse(
  readFileSync(resolve(source, "package-lock.json"), "utf8"),
);
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, lock.version, "Package and lockfile versions differ");
assert.equal(pkg.version, lock.packages[""].version);
const repo = "https://github.com/BColsey/hermes-multi-chat";
const distributions = [`multi-chat-${pkg.version}.tar.gz`, "install.py"].map(
  (name) => {
    const path = resolve(assets, name);
    const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(
      readFileSync(path + ".sha256", "utf8").trim(),
      `${hash}  ${name}`,
      `${name}: checksum mismatch`,
    );
    return {
      type: "distribution",
      url: `${repo}/releases/download/v${pkg.version}/${name}`,
      hashes: [{ alg: "SHA-256", content: hash }],
    };
  },
);
const bom = JSON.parse(
  execFileSync(
    "npm",
    [
      "sbom",
      "--package-lock-only",
      "--omit=dev",
      "--sbom-format=cyclonedx",
      "--sbom-type=application",
      "--ignore-scripts",
    ],
    { cwd: source, encoding: "utf8" },
  ),
);
assert.equal(bom.bomFormat, "CycloneDX");
assert.equal(bom.specVersion, "1.5");
// npm uses the directory basename for the root name; do not disclose it.
bom.metadata.component.name = pkg.name;
bom.metadata.component.purl = `pkg:github/BColsey/hermes-multi-chat@v${pkg.version}`;
bom.metadata.component.externalReferences = [
  ...(bom.metadata.component.externalReferences || []),
  ...distributions,
];
bom.metadata.lifecycles = [{ phase: "post-build" }];
bom.metadata.properties = [
  {
    name: "hermes:sbom:scope",
    value:
      "Bundled npm runtime dependencies only. Host Hermes/React/FastAPI, Python stdlib and build/test tools are outside this inventory.",
  },
];
// Optional generation identifiers are omitted for repeatable output per toolchain.
delete bom.serialNumber;
delete bom.metadata.timestamp;
const name = `multi-chat-${pkg.version}.cdx.json`;
const json = JSON.stringify(bom, null, 2) + "\n";
writeFileSync(resolve(assets, name), json);
writeFileSync(
  resolve(assets, name + ".sha256"),
  `${createHash("sha256").update(json).digest("hex")}  ${name}\n`,
);
console.log(
  `Generated ${basename(name)} and its SHA-256 receipt (runtime dependencies only).`,
);
