/**
 * Static asset serving for the OpenColab web client.
 * Resolves the built client bundle in both packaged and source-tree modes.
 */
import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8"
};

const ASSET_ROOT_CANDIDATES = [
  // Packaged install: dist/web sibling to dist/src/web/server
  path.resolve(MODULE_DIR, "../../../web"),
  path.resolve(MODULE_DIR, "../../../../dist/web"),
  // Source tree: src/web/server -> src/web/client/dist
  path.resolve(MODULE_DIR, "../client/dist"),
  path.resolve(MODULE_DIR, "../../../src/web/client/dist")
];

let cachedAssetRoot: string | null | undefined;

export function resolveWebAssetRoot(): string | null {
  if (cachedAssetRoot !== undefined) {
    return cachedAssetRoot;
  }
  for (const candidate of ASSET_ROOT_CANDIDATES) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      cachedAssetRoot = candidate;
      return candidate;
    }
  }
  cachedAssetRoot = null;
  return null;
}

export function getAssetMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function serveStaticAsset(
  response: ServerResponse,
  pathname: string
): boolean {
  const root = resolveWebAssetRoot();
  if (!root) {
    return false;
  }

  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requested).replace(/^\/+/, "");
  const fullPath = path.join(root, safePath);
  if (!fullPath.startsWith(root)) {
    return false;
  }

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    sendFile(response, fullPath);
    return true;
  }

  // SPA fallback: serve index.html for non-API browser routes.
  const indexPath = path.join(root, "index.html");
  if (fs.existsSync(indexPath)) {
    sendFile(response, indexPath, { cache: false });
    return true;
  }

  return false;
}

function sendFile(
  response: ServerResponse,
  filePath: string,
  options: { cache?: boolean } = {}
): void {
  const buffer = fs.readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": getAssetMimeType(filePath),
    "Cache-Control": options.cache === false ? "no-store" : "public, max-age=300"
  });
  response.end(buffer);
}
