"use strict";
// Static integration contract. Real browser enforcement is exercised separately.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const file = path.resolve(process.argv[2] || path.join(root, "index.html"));
const html = fs.readFileSync(file, "utf8");
const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?\s*>/i);
const policy = Object.create(null);
if (meta) for (const directive of meta[1].split(";")) {
  const parts = directive.trim().split(/\s+/); if (parts[0]) policy[parts[0]] = parts.slice(1);
}
let passed = 0, failed = 0;
function test(name, run) { try { run(); passed++; console.log("PASS: " + name); }
  catch (e) { failed++; console.log("FAIL: " + name + ": " + e.message.split("\n")[0]); } }
function includes(directive, ...tokens) { for (const token of tokens) assert.ok(policy[directive]?.includes(token), directive + " needs " + token); }
test("one enforced CSP meta precedes all resource loads; no fictitious report-only meta", () => {
  assert.ok(meta, "CSP meta is missing");
  assert.equal((html.match(/http-equiv="Content-Security-Policy"/gi)||[]).length, 1);
  assert.ok(html.indexOf(meta[0]) > html.indexOf('<meta charset="UTF-8">'));
  assert.ok(html.indexOf(meta[0]) < html.search(/<(?:link|script)\b/i));
  assert.doesNotMatch(html, /http-equiv="Content-Security-Policy-Report-Only"/i);
  for (const directive of ["sandbox", "frame-ancestors", "report-uri", "upgrade-insecure-requests", "block-all-mixed-content"]) assert.equal(policy[directive], undefined, directive);
});
test("only local external scripts; eval, inline code, event attributes, base injection and embeds disabled", () => {
  assert.deepEqual(policy["script-src"], ["'self'", "file:"]);
  assert.deepEqual(policy["script-src-attr"], ["'none'"]);
  for (const directive of ["base-uri", "object-src", "frame-src", "form-action"]) assert.deepEqual(policy[directive], ["'none'"]);
  assert.doesNotMatch(html, /\son(?:click|load|error|submit|change|input)\s*=/i);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) assert.equal(match[2].trim(), "");
});
test("styles/fonts use local sources only; unused Google Fonts hosts are not authorized", () => {
  assert.deepEqual(policy["style-src"], ["'self'", "file:", "'unsafe-inline'"]);
  assert.deepEqual(policy["font-src"], ["'self'", "file:", "data:"]);
  includes("img-src", "'self'", "file:", "data:", "blob:", "http:", "https:");
  includes("manifest-src", "'self'", "file:");
});
test("custom HTTP(S) endpoints, proxy ports, image fetches and blob workers are not host-allowlisted", () => {
  includes("connect-src", "'self'", "http:", "https:", "blob:", "data:");
  includes("worker-src", "'self'", "blob:");
  assert.ok(!policy["worker-src"].includes("data:"), "Workers need blob URLs, not data URLs");
  includes("child-src", "'self'", "blob:"); // CSP2 fallback; frame-src still none.
  const custom = ["http://127.0.0.1:18081/v1", "http://127.0.0.1:18160/v1", "http://localhost:43210/proxy",
    "https://tenant.custom.example:9443/v1/images/generations", "http://192.0.2.4:12345/v1"];
  for (const url of custom) assert.ok(policy["connect-src"].includes(new URL(url).protocol));
});
test("every modern application script is inert until the final guard enables ordered loading", () => {
  const tags = [...html.matchAll(/<script\b([^>]*)><\/script>/gi)].map(x => x[1]);
  const expected = ["image-task-stability.js", "codex-image-gateway.js", "gemini-image-size-registry.js",
    "gemini-web-image-adapter.js", "gemini-selector-pack.js", "gemini-watermark-remover.bundle.js", "app.js", "studio-shell.js"];
  const deferred = tags.filter(x => x.includes('type="application/x-ai-gen-script"'));
  assert.equal(deferred.length, expected.length);
  for (let i = 0; i < deferred.length; i++) {
    assert.ok(deferred[i].includes('data-src="' + expected[i] + '?v='));
    assert.doesNotMatch(deferred[i], /(?:^|\s)src=/);
  }
  const executable = tags.filter(x => !x.includes('type="application/x-ai-gen-script"'));
  assert.equal(executable.length, 1); assert.match(executable[0], /src="bootstrap-guard\.js\?v=/);
  assert.match(executable[0], /\sdata-ai-gen-autoload(?:\s|$|=)/);
  assert.equal(tags[tags.length - 1], executable[0]);
});
test("inventory preserves actual main-page/native routing; embedded Gemini worker is a separate document", () => {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const native = fs.readFileSync(path.join(root, "lib/main.dart"), "utf8");
  const gemini = fs.readFileSync(path.join(root, "lib/gemini_embedded_browser.dart"), "utf8");
  assert.match(app, /nativeDownload\.nativeFetchPayload/); assert.match(app, /fetch\(proxy,/);
  assert.match(app, /fetch\(url,/); assert.match(app, /new Response\(/);
  assert.match(app, /URL\.createObjectURL/); assert.match(app, /serviceWorker\.register\("sw\.js"\)/);
  assert.match(native, /loadFlutterAsset\('index\.html'\)/); assert.match(native, /Uri\.file\(indexFile\.path\)/);
  assert.match(native, /addScriptToExecuteOnDocumentCreated\(_windowsBridgeScript\)/);
  assert.match(gemini, /gemini-embedded-worker\.js/); assert.match(gemini, /addScriptToExecuteOnDocumentCreated\(injectedWorker\)/);
  assert.doesNotMatch(html, /(?:data-src|src)="gemini-embedded-worker\.js/);
});
console.log(`RESULT: ${passed}/${passed + failed} CSP checks passed`);
process.exitCode = failed ? 1 : 0;
