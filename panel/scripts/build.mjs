import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const files = [
  ["/", "index.html", "text/html"],
  ["/style.css", "style.css", "text/css"],
  ["/data.js", "data.js", "text/javascript"],
  ["/model.js", "model.js", "text/javascript"],
  ["/sync.js", "sync.js", "text/javascript"],
  ["/app.js", "app.js", "text/javascript"]
];
const assets = await Promise.all(files.map(async ([path, file, type]) => [
  path,
  { body: await readFile("public/" + file, "utf8"), type: type + "; charset=utf-8" }
]));
const model = await readFile("public/model.js", "utf8");
const worker = await readFile("server/worker.mjs", "utf8");
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", "const assets = new Map(" + JSON.stringify(assets) + ");\n" + model + worker);
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
