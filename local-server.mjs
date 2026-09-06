import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const host = "127.0.0.1";
const requestedPort = Number.parseInt(process.env.PORT || "4173", 10);
const port = Number.isInteger(requestedPort) ? requestedPort : 4173;
const routes = new Map([
  ["/", "index.html"],
  ["/admin", "admin.html"],
  ["/admin/", "admin.html"],
]);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function send(res, status, body = "", contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  res.end(body);
}

createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url || "/", "http://localhost").pathname,
    );
  } catch {
    return send(res, 400, "Bad request");
  }

  const relative = routes.get(pathname) || pathname.replace(/^\/+/, "");
  const file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root + sep))
    return send(res, 403, "Forbidden");

  try {
    const contents = await readFile(file);
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": contents.length,
      "Content-Type":
        mime[extname(file).toLowerCase()] || "application/octet-stream",
    });
    res.end(req.method === "HEAD" ? undefined : contents);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR")
      return send(res, 404, "Not found");
    console.error(error);
    return send(res, 500, "Internal server error");
  }
}).listen(port, host, () => {
  console.log(`Snack House local server: http://${host}:${port}`);
  console.log(`Admin dashboard: http://${host}:${port}/admin`);
});
