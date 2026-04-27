const fs = require("fs");
const path = require("path");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function createStaticHandler(publicDir) {
  const rootDir = path.resolve(publicDir);

  return function handleHttpRequest(req, res) {
    const requestPath = req.url ? new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname : "/";

    if (requestPath === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }

    const requestedPath = requestPath === "/" ? "/index.html" : requestPath;
    const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.resolve(rootDir, `.${safePath}`);
    const relativePath = path.relative(rootDir, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  };
}

module.exports = { createStaticHandler };
