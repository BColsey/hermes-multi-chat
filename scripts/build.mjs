import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
await mkdir("dashboard/dist", { recursive: true });
const result = await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  outfile: "dashboard/dist/index.js",
  format: "iife",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  metafile: true,
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
});
if (
  Object.keys(result.metafile.inputs).some((p) =>
    /node_modules\/(react|react-dom)\//.test(p),
  )
)
  throw new Error("A second React was bundled");
const css = await readFile("src/style.css", "utf8");
// Scope xterm CSS to the plugin: installing it must not restyle Normal Chat.
const xterm = (
  await readFile("node_modules/@xterm/xterm/css/xterm.css", "utf8")
).replace(
  /(^|[}])\s*([^@}{][^{}]*)\{/g,
  (_m, boundary, selectors) =>
    boundary +
    "\n" +
    selectors
      .split(",")
      .map((s) => ".mc-root " + s.trim())
      .join(",") +
    " {",
);
await writeFile("dashboard/dist/style.css", xterm + "\n" + css);
await mkdir("dashboard/dist/licenses", { recursive: true });
for (const name of ["xterm", "addon-fit", "addon-unicode11"])
  await copyFile(
    "node_modules/@xterm/" + name + "/LICENSE",
    "dashboard/dist/licenses/" + name + ".txt",
  );
await writeFile(
  "dashboard/dist/build-meta.json",
  JSON.stringify(
    {
      inputs: Object.keys(result.metafile.inputs),
      outputs: result.metafile.outputs,
    },
    null,
    2,
  ) + "\n",
);
console.log("Built local IIFE/CSS; host React only.");
