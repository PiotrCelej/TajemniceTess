import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import "./build.mjs";

const { default: worker } = await import("../dist/server/index.js");
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await readFile("drizzle/0000_campaign_progress.sql", "utf8"));
const DB = {
  prepare(sql) {
    return {
      bind(...args) {
        return { all: () => ({ results: sqlite.prepare(sql).all(...args) }), run: () => sqlite.prepare(sql).run(...args) };
      }
    };
  }
};

const portArg = process.argv.indexOf("--port");
const port = Number(portArg === -1 ? process.env.PORT || 3000 : process.argv[portArg + 1]);
const hostArg = process.argv.indexOf("--host");
const host = hostArg === -1 ? "127.0.0.1" : process.argv[hostArg + 1];
createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(req.headers);
    headers.set("oai-authenticated-user-id", "local-preview");
    const request = new Request(new URL(req.url, headers.get("origin") || "http://" + req.headers.host), {
      method: req.method,
      headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks)
    });
    const response = await worker.fetch(request, { DB });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
  }
}).listen(port, host, () => console.log("Rudna Brama preview listening on port " + port));
