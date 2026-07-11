// Local CORS proxy for the standalone browser build.
// Run: node api-proxy.js
// Paste the complete tokenized URL printed at startup into "浏览器 CORS 转发地址".

"use strict";

const crypto = require("crypto");
const dns = require("dns").promises;
const http = require("http");
const net = require("net");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_TOKEN = process.env.AI_PROXY_TOKEN || crypto.randomBytes(24).toString("base64url");
// Proxy payloads encode reference images as base64 (roughly 4/3 of source bytes),
// so this must be comfortably above the UI's 25 MB per-image limit.
const MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = Number(process.env.AI_PROXY_TIMEOUT_MS || 0);

function isAllowedOrigin(origin) {
  if (!origin || origin === "null") return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  return {
    "Access-Control-Allow-Origin": origin && origin !== "null" ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-AI-Proxy-Token",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...corsHeaders(req), ...headers });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        settled = true;
        chunks.length = 0;
        const error = new Error("request body exceeds 128 MB");
        error.statusCode = 413;
        reject(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (err) {
        const error = new Error(`invalid JSON: ${err.message}`);
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function cleanForwardHeaders(headers = {}, dropContentType = false) {
  const out = {};
  const blocked = new Set([
    "host", "content-length", "connection", "transfer-encoding", "upgrade",
    "proxy-authorization", "proxy-connection", "cookie", "origin", "referer",
  ]);
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (blocked.has(lower) || lower.startsWith("sec-") || (dropContentType && lower === "content-type")) continue;
    out[key] = String(value);
  }
  return out;
}

function base64ToBlob(base64, mimeType) {
  const bytes = Buffer.from(base64 || "", "base64");
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function buildUpstreamRequest(payload, signal) {
  const method = String(payload.method || "GET").toUpperCase();
  if (!new Set(["GET", "POST"]).has(method)) throw new Error("Only GET and POST upstream methods are allowed");
  if (payload.bodyType === "formData") {
    const form = new FormData();
    for (const field of payload.fields || []) {
      if (!field || !field.name) continue;
      if (field.type === "blob") {
        form.append(field.name, base64ToBlob(field.base64, field.mimeType), field.filename || "upload.bin");
      } else {
        form.append(field.name, field.value == null ? "" : String(field.value));
      }
    }
    return { method, headers: cleanForwardHeaders(payload.headers, true), body: form, signal };
  }
  return {
    method,
    headers: cleanForwardHeaders(payload.headers, false),
    body: method === "GET" ? undefined : (payload.body || undefined),
    signal,
  };
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  if (net.isIPv4(value)) return isPrivateIpv4(value);
  if (!net.isIPv6(value)) return true;
  if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

async function assertSafeTarget(target, allowPrivateTargets = false) {
  if (!/^https?:$/.test(target.protocol)) throw new Error("Only http/https targets are allowed");
  if (target.username || target.password) throw new Error("Target URLs containing credentials are not allowed");
  if (allowPrivateTargets) return;
  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local/private target addresses are blocked");
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error("Local/private target addresses are blocked");
  }
}

function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function readLimitedResponse(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("upstream response exceeds 128 MB");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("upstream response exceeds 128 MB");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function createProxyServer(options = {}) {
  const token = options.token || DEFAULT_TOKEN;
  const allowPrivateTargets = options.allowPrivateTargets === true || process.env.AI_PROXY_ALLOW_PRIVATE === "1";
  const timeoutMs = Number(options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  return http.createServer(async (req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      send(req, res, 403, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Origin is not allowed" }));
      return;
    }
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const suppliedToken = requestUrl.searchParams.get("token") || req.headers["x-ai-proxy-token"];
    if (!tokenMatches(suppliedToken, token)) {
      send(req, res, 401, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Invalid proxy token" }));
      return;
    }
    if (req.method === "OPTIONS") {
      send(req, res, 204, {}, "");
      return;
    }
    if (req.method !== "POST" || requestUrl.pathname !== "/proxy") {
      send(req, res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
      return;
    }
    const declaredRequestBytes = Number(req.headers["content-length"] || 0);
    if (declaredRequestBytes > MAX_REQUEST_BYTES) {
      req.resume();
      send(req, res, 413, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "request body exceeds 128 MB" }));
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    let timer = null;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    const abortDisconnectedClient = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abortDisconnectedClient);
    res.once("close", abortDisconnectedClient);
    try {
      const payload = await readJson(req);
      const target = new URL(payload.url);
      await assertSafeTarget(target, allowPrivateTargets);
      const upstream = await fetch(target, buildUpstreamRequest(payload, controller.signal));
      const bytes = await readLimitedResponse(upstream);
      send(req, res, upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      }, bytes);
    } catch (err) {
      if (!res.destroyed && !res.writableEnded) {
        const status = Number(err?.statusCode) || (timedOut ? 504 : 502);
        const message = timedOut ? "upstream request timed out" : (err.message || String(err));
        send(req, res, status, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: message }));
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
      req.off("aborted", abortDisconnectedClient);
      res.off("close", abortDisconnectedClient);
    }
  });
}

if (require.main === module) {
  const server = createProxyServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`AI Image Generator browser proxy: http://127.0.0.1:${PORT}/proxy?token=${DEFAULT_TOKEN}`);
    console.log("Keep this token private. A new random token is generated on every start unless AI_PROXY_TOKEN is set.");
  });
}

module.exports = {
  assertSafeTarget,
  createProxyServer,
  isAllowedOrigin,
  isPrivateAddress,
  tokenMatches,
};
