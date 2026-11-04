import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Inspect precisely what Git can publish, not ignored private test state.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const roots = new Set([
  "README.md",
  ".gitignore",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "install.py",
  "requirements-dev.txt",
  "requirements-security.txt",
  "ruff.toml",
  "tsconfig.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "eslint.config.mjs",
]);
const privatePath =
  /^(?:\.dev|\.serena|node_modules|artifacts|test-results|playwright-report|assets)(?:\/|$)|^docs\/evidence\/|^dashboard\/dist\/|(?:^|\/)\.env(?:\.|$)/;
const patterns = [
  [/\/(?:home|Users)\/[^/\s"'`]+\//, "personal absolute path"],
  [
    /\b(?:10(?:\.\d{1,3}){3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
    "private LAN address",
  ],
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{32,})\b/,
    "possible credential",
  ],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
];
const secrets = Object.entries(process.env)
  .filter(
    ([key, value]) =>
      /(?:TOKEN|PASSWORD|API_KEY|SECRET)$/.test(key) && value?.length >= 16,
  )
  .map(([, value]) => value);
if (process.env.PUBLICATION_FORBIDDEN_FILE) {
  const extra = JSON.parse(
    readFileSync(process.env.PUBLICATION_FORBIDDEN_FILE, "utf8"),
  );
  if (
    !Array.isArray(extra) ||
    extra.some((v) => typeof v !== "string" || v.length < 8)
  )
    throw new Error("Invalid private publication guard file");
  secrets.push(...extra);
}
const errors = [];
const textFiles = new Map();
for (const file of files) {
  if (!existsSync(file)) continue;
  if (
    privatePath.test(file) ||
    !(
      roots.has(file) ||
      /^(?:src|tests|scripts|docs|\.github|verification)\//.test(file) ||
      /^dashboard\/(?:manifest\.json|plugin_api\.py)$/.test(file)
    )
  ) {
    errors.push(`${file}: unexpected publication path`);
    continue;
  }
  if (!lstatSync(file).isFile()) {
    errors.push(`${file}: not a regular file`);
    continue;
  }
  if (/\.(?:png|webp|jpg)$/.test(file)) continue; // Images require a human privacy review.
  const value = readFileSync(file, "utf8");
  textFiles.set(resolve(file), value);
  for (const [pattern, label] of patterns)
    if (pattern.test(value)) errors.push(`${file}: ${label}`);
  if (secrets.some((secret) => value.includes(secret)))
    errors.push(`${file}: private guard value found (value withheld)`);
}
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
for (const [file, value] of textFiles) {
  if (!file.endsWith(".md")) continue;
  for (const match of value.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const link = match[1];
    if (/^(?:https?:|mailto:)/.test(link)) continue;
    const [path, anchor] = link.split("#");
    const target = path
      ? resolve(dirname(file), decodeURIComponent(path))
      : file;
    const line = value.slice(0, match.index).split("\n").length;
    if (!existsSync(target))
      errors.push(
        `${file.slice(process.cwd().length + 1)}:${line}: broken local documentation link`,
      );
    else if (anchor && target.endsWith(".md")) {
      const headings = [
        ...readFileSync(target, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm),
      ].map((m) => slug(m[1]));
      if (!headings.includes(anchor))
        errors.push(
          `${file.slice(process.cwd().length + 1)}:${line}: missing heading anchor`,
        );
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Public-tree privacy patterns and local Markdown links passed (${files.length} files). Review images and Git history separately.`,
  );
