"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createProxyServer, isPrivateAddress } = require("../api-proxy.js");

async function listen(server) {
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  return server.address().port;
}

function rawPost(port, headers, body = "") {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/proxy?token=secret", method: "POST", headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

test("private and loopback addresses are classified safely", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.2"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("proxy requires its token and rejects foreign browser origins", async t => {
  const proxy = createProxyServer({ token: "secret", timeoutMs: 2000 });
  const port = await listen(proxy);
  t.after(() => proxy.close());

  const noToken = await fetch(`http://127.0.0.1:${port}/proxy`, { method: "POST", body: "{}" });
  assert.equal(noToken.status, 401);
  const foreign = await fetch(`http://127.0.0.1:${port}/proxy?token=secret`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.equal(foreign.status, 403);
});

test("proxy forwards an allowed request and preserves binary bytes", async t => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from([0, 1, 2, 255]));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.close());

  const proxy = createProxyServer({ token: "secret", allowPrivateTargets: true, timeoutMs: 2000 });
  const proxyPort = await listen(proxy);
  t.after(() => proxy.close());

  const response = await fetch(`http://127.0.0.1:${proxyPort}/proxy?token=secret`, {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:9000", "Content-Type": "application/json" },
    body: JSON.stringify({ url: `http://127.0.0.1:${upstreamPort}/image`, method: "GET" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 1, 2, 255]));
});

test("proxy blocks private targets by default", async t => {
  const proxy = createProxyServer({ token: "secret", timeoutMs: 2000 });
  const port = await listen(proxy);
  t.after(() => proxy.close());
  const response = await fetch(`http://127.0.0.1:${port}/proxy?token=secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1:12345/private", method: "GET" }),
  });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /private target/i);
});

test("proxy reports malformed or oversized request bodies without dropping the socket", async t => {
  const proxy = createProxyServer({ token: "secret", timeoutMs: 2000 });
  const port = await listen(proxy);
  t.after(() => proxy.close());

  const malformed = await rawPost(port, { "Content-Type": "application/json", "Content-Length": "1" }, "{");
  assert.equal(malformed.status, 400);
  assert.match(malformed.body, /invalid JSON/i);

  const oversized = await rawPost(port, { "Content-Type": "application/json", "Content-Length": String(128 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.match(oversized.body, /exceeds 128 MB/i);
});

test("proxy aborts the upstream request when the browser cancels", async t => {
  let upstreamStarted = false;
  let upstreamClosed = false;
  const upstream = http.createServer((request) => {
    upstreamStarted = true;
    request.on("aborted", () => { upstreamClosed = true; });
    request.on("close", () => { upstreamClosed = true; });
    // Deliberately never respond.
  });
  const upstreamPort = await listen(upstream);
  t.after(() => upstream.closeAllConnections?.());
  t.after(() => upstream.close());

  const proxy = createProxyServer({ token: "secret", allowPrivateTargets: true, timeoutMs: 0 });
  const proxyPort = await listen(proxy);
  t.after(() => proxy.closeAllConnections?.());
  t.after(() => proxy.close());

  const controller = new AbortController();
  const pending = fetch(`http://127.0.0.1:${proxyPort}/proxy?token=secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `http://127.0.0.1:${upstreamPort}/slow`, method: "GET" }),
    signal: controller.signal,
  }).catch(error => error);
  for (let i = 0; i < 50 && !upstreamStarted; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort();
  await pending;
  for (let i = 0; i < 50 && !upstreamClosed; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(upstreamStarted, true);
  assert.equal(upstreamClosed, true);
});
