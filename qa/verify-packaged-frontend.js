"use strict";
// Read-only packaging gate: version labels alone do not detect mixed assets.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const assets = path.resolve(process.argv[2] || path.join(root,"android/app/src/main/assets"));
const spec = fs.readFileSync(path.join(root,"pubspec.yaml"),"utf8");
const block = spec.split(/^  assets:\s*$/m)[1]?.split(/^\S|^  \S/m)[0] || "";
const files = [...block.matchAll(/^    - ([^\r\n]+)$/gm)].map(m=>m[1].trim()).filter(p=>!p.endsWith("/"));
if (!files.includes("studio-shell.js") || !files.includes("bootstrap-guard.js")) throw Error("Incomplete frontend manifest");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const name of files) {
  if (!fs.existsSync(path.join(assets,name))) throw Error(`Missing packaged asset: ${name}`);
  if (hash(path.join(root,name)) !== hash(path.join(assets,name))) throw Error(`Packaged asset differs from source: ${name}`);
}
console.log(`PASS: ${files.length} packaged frontend assets match source SHA-256 (including startup, shell, providers and watermark engine)`);
