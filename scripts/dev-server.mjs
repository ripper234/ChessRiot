import http from "node:http";

import worker from "../worker/index.js";

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const host = argumentValue("--host", "0.0.0.0");
const port = Number(argumentValue("--port", "4173"));

const server = http.createServer(async (incoming, outgoing) => {
  try {
    const origin = `http://${incoming.headers.host || `${host}:${port}`}`;
    const request = new Request(new URL(incoming.url || "/", origin), {
      method: incoming.method,
      headers: incoming.headers,
    });
    const response = await worker.fetch(request, process.env, {});
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => outgoing.setHeader(key, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end("Preview failed");
  }
});

server.listen(port, host, () => {
  console.log(`ChessRiot Control preview ready on ${host}:${port}`);
});
