const path = require('path');

// ASSETS_ROOT — the directory holding read-only files that ship inside the
// PKG binary (templates, frontend dist, bundled JSON configs).
// In PKG, __dirname resolves into the snapshot virtual filesystem, so
// __dirname/.. lands at the project root inside the snapshot.
// In Node (dev), it resolves to the actual project root on disk.
const ASSETS_ROOT = path.join(__dirname, '..');

// RUNTIME_ROOT — the directory holding writable runtime files
// (uploads, challans, generated PDFs, .env, optional portable chromium).
// In PKG, process.execPath is the actual .exe on disk, so its directory
// is where the user-visible runtime files should live.
// In dev, this is the project root (same as ASSETS_ROOT).
const RUNTIME_ROOT = process.pkg
    ? path.dirname(process.execPath)
    : ASSETS_ROOT;

const asset = (...segments) => path.join(ASSETS_ROOT, ...segments);
const runtime = (...segments) => path.join(RUNTIME_ROOT, ...segments);

module.exports = {
    ASSETS_ROOT,
    RUNTIME_ROOT,
    asset,
    runtime,
};
