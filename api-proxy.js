// Local API proxy for desktop browser use.
// Run: node api-proxy.js
// Then set the desktop proxy URL to: http://127.0.0.1:8787/proxy

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);

function send(res, status, headers, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...headers,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 25 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function cleanForwardHeaders(headers = {}, dropContentType = false) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length") continue;
    if (dropContentType && lower === "content-type") continue;
    out[key] = value;
  }
  return out;
}

function base64ToBlob(base64, mimeType) {
  const bytes = Buffer.from(base64 || "", "base64");
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

function buildUpstreamRequest(payload) {
  const method = payload.method || "GET";
  if (payload.bodyType === "formData") {
    const form = new FormData();
    for (const field of payload.fields || []) {
      if (!field || !field.name) continue;
      if (field.type === "blob") {
        form.append(
          field.name,
          base64ToBlob(field.base64, field.mimeType),
          field.filename || "upload.bin"
        );
      } else {
        form.append(field.name, field.value == null ? "" : String(field.value));
      }
    }
    return {
      method,
      headers: cleanForwardHeaders(payload.headers, true),
      body: form,
    };
  }
  return {
    method,
    headers: cleanForwardHeaders(payload.headers, false),
    body: payload.body || undefined,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {}, "");
    return;
  }
  if (req.method !== "POST" || req.url !== "/proxy") {
    send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  try {
    const payload = await readJson(req);
    const target = new URL(payload.url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("Only http/https targets are allowed");

    const upstream = await fetch(target, buildUpstreamRequest(payload));
    const text = await upstream.text();
    send(res, upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    }, text);
  } catch (err) {
    send(res, 502, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({
      error: err.message || String(err),
    }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI Image Generator proxy listening at http://127.0.0.1:${PORT}/proxy`);
});
