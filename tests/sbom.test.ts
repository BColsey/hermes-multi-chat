import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "multi-chat-sbom-"));
  const source = resolve(root, "private-directory-name");
  const assets = resolve(root, "assets");
  mkdirSync(source);
  mkdirSync(assets);
  const pkg = {
    name: "hermes-dashboard-multi-chat",
    version: "1.2.3",
    private: true,
    license: "MIT",
    dependencies: { "@xterm/xterm": "6.0.0" },
    devDependencies: { vitest: "4.1.12" },
  };
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: {
      "": pkg,
      "node_modules/@xterm/xterm": {
        version: "6.0.0",
        license: "MIT",
        integrity: "sha512-" + Buffer.alloc(64, 1).toString("base64"),
        resolved: "https://registry.npmjs.org/@xterm/xterm/-/xterm-6.0.0.tgz",
      },
      "node_modules/vitest": { version: "4.1.12", dev: true },
    },
  };
  writeFileSync(resolve(source, "package.json"), JSON.stringify(pkg));
  writeFileSync(resolve(source, "package-lock.json"), JSON.stringify(lock));
  for (const name of ["multi-chat-1.2.3.tar.gz", "install.py"]) {
    const body = Buffer.from("synthetic " + name);
    writeFileSync(resolve(assets, name), body);
    writeFileSync(
      resolve(assets, name + ".sha256"),
      createHash("sha256").update(body).digest("hex") + "  " + name + "\n",
    );
  }
  return {
    root,
    source,
    assets,
    output: resolve(assets, "multi-chat-1.2.3.cdx.json"),
  };
}
function run(source: string, assets: string) {
  return execFileSync(process.execPath, ["scripts/sbom.mjs", source, assets], {
    encoding: "utf8",
    stdio: "pipe",
  });
}
test("SBOM excludes development packages and local names, binds assets and repeats deterministically", () => {
  const f = fixture();
  try {
    run(f.source, f.assets);
    const text = readFileSync(f.output, "utf8");
    const bom = JSON.parse(text);
    expect(bom.metadata.component.name).toBe("hermes-dashboard-multi-chat");
    expect(bom.components.map((c: { name: string }) => c.name)).toEqual([
      "@xterm/xterm",
    ]);
    expect(text).not.toContain("private-directory-name");
    expect(text).not.toContain(f.root);
    expect(
      bom.metadata.component.externalReferences.filter(
        (r: { type: string }) => r.type === "distribution",
      ),
    ).toHaveLength(2);
    expect(
      bom.metadata.component.externalReferences.at(-1).hashes[0].content,
    ).toBe(
      createHash("sha256")
        .update(readFileSync(resolve(f.assets, "install.py")))
        .digest("hex"),
    );
    expect(readFileSync(f.output + ".sha256", "utf8")).toBe(
      createHash("sha256").update(text).digest("hex") +
        "  multi-chat-1.2.3.cdx.json\n",
    );
    run(f.source, f.assets);
    expect(readFileSync(f.output, "utf8")).toBe(text);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("SBOM refuses changed release files before generating inventory", () => {
  const f = fixture();
  try {
    writeFileSync(resolve(f.assets, "install.py"), "tampered");
    expect(() => run(f.source, f.assets)).toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
