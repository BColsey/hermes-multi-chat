import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("artifacts", { recursive: true });
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const name = "artifacts/multi-chat-" + version + ".tar.gz";
const manifest = JSON.parse(await readFile("dashboard/manifest.json", "utf8"));
const installerVersion = execFileSync("python3", ["install.py", "--version"], {
  encoding: "utf8",
}).trim();
if (manifest.version !== version || installerVersion !== version)
  throw new Error(
    "Package, dashboard manifest and installer versions must match.",
  );
execFileSync("tar", [
  "--sort=name",
  "--mtime=UTC 2020-01-01",
  "--owner=0",
  "--group=0",
  "--numeric-owner",
  "--transform=s,^dashboard,multi-chat/dashboard,",
  "-czf",
  name,
  "dashboard/manifest.json",
  "dashboard/plugin_api.py",
  "dashboard/dist",
]);
await writeFile(
  name + ".sha256",
  createHash("sha256")
    .update(await readFile(name))
    .digest("hex") +
    "  " +
    name.split("/").pop() +
    "\n",
);
await copyFile("install.py", "artifacts/install.py");
const installerHash = createHash("sha256")
  .update(await readFile("artifacts/install.py"))
  .digest("hex");
await writeFile(
  "artifacts/install.py.sha256",
  installerHash + "  install.py\n",
);
await writeFile(
  "artifacts/SHA256SUMS",
  (await readFile(name + ".sha256", "utf8")) + installerHash + "  install.py\n",
);
console.log(name);
console.log("artifacts/install.py and SHA256SUMS");
