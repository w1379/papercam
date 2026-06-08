const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 5173);
const HOST = "127.0.0.1";
const ROOT = __dirname;
const CAPTURE_DIR = path.join(ROOT, "captures");

fs.mkdirSync(CAPTURE_DIR, { recursive: true });

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendText(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

function safeCaptureName(name) {
  const baseName = path.basename(name || "");
  if (!/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(baseName)) {
    return null;
  }
  return baseName;
}

function numberedParts(fileName) {
  const match = /^(\d{4})(?:_(\d{2}))?\.png$/i.exec(fileName);
  if (!match) return null;
  return {
    base: Number(match[1]),
    baseName: match[1],
    edit: match[2] ? Number(match[2]) : 0,
  };
}

function captureRecord(fileName) {
  const filePath = path.join(CAPTURE_DIR, fileName);
  const stat = fs.statSync(filePath);
  const parts = numberedParts(fileName);
  return {
    id: fileName,
    name: fileName,
    url: `/captures/${encodeURIComponent(fileName)}`,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    seriesBase: parts?.baseName || null,
    seriesIndex: parts?.base || null,
    editIndex: parts?.edit || 0,
    isNumbered: Boolean(parts),
  };
}

function captureFileNames() {
  return fs
    .readdirSync(CAPTURE_DIR)
    .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name));
}

function nextBaseName() {
  const maxBase = captureFileNames().reduce((max, name) => {
    const parts = numberedParts(name);
    return parts ? Math.max(max, parts.base) : max;
  }, 0);
  return String(maxBase + 1).padStart(4, "0");
}

function sourceBaseName(sourceName) {
  const parts = numberedParts(sourceName);
  return parts?.baseName || null;
}

function nextEditName(sourceName) {
  const baseName = sourceBaseName(sourceName);
  if (!baseName) {
    const stem = path.basename(sourceName, path.extname(sourceName));
    const editNames = captureFileNames()
      .map((name) => new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_edit(\\d{2})\\.png$`, "i").exec(name))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    const nextEdit = Math.max(0, ...editNames) + 1;
    return `${stem}_edit${String(nextEdit).padStart(2, "0")}.png`;
  }

  const maxEdit = captureFileNames().reduce((max, name) => {
    const parts = numberedParts(name);
    if (!parts || parts.baseName !== baseName) return max;
    return Math.max(max, parts.edit);
  }, 0);
  return `${baseName}_${String(maxEdit + 1).padStart(2, "0")}.png`;
}

function listCaptures() {
  return captureFileNames()
    .map(captureRecord)
    .sort((a, b) => {
      if (a.isNumbered && b.isNumbered) {
        if (a.seriesIndex !== b.seriesIndex) return b.seriesIndex - a.seriesIndex;
        return b.editIndex - a.editIndex;
      }
      if (a.isNumbered !== b.isNumbered) return a.isNumbered ? -1 : 1;
      return b.modifiedAt - a.modifiedAt;
    });
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/captures") {
    sendJson(response, 200, listCaptures());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/captures") {
    try {
      const fileName = `${nextBaseName()}.png`;
      const body = await collectBody(request);
      fs.writeFileSync(path.join(CAPTURE_DIR, fileName), body);
      sendJson(response, 201, captureRecord(fileName));
    } catch (error) {
      sendText(response, 500, error.message);
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/edits") {
    const sourceName = safeCaptureName(url.searchParams.get("source"));
    if (!sourceName) {
      sendText(response, 400, "Invalid source name");
      return true;
    }

    try {
      const fileName = nextEditName(sourceName);
      const body = await collectBody(request);
      fs.writeFileSync(path.join(CAPTURE_DIR, fileName), body);
      sendJson(response, 201, captureRecord(fileName));
    } catch (error) {
      sendText(response, 500, error.message);
    }
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/captures/")) {
    const fileName = safeCaptureName(decodeURIComponent(url.pathname.slice("/api/captures/".length)));
    if (!fileName) {
      sendText(response, 400, "Invalid capture name");
      return true;
    }

    const filePath = path.join(CAPTURE_DIR, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/shutdown") {
    sendJson(response, 200, { ok: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 800).unref();
    }, 120).unref();
    return true;
  }

  return false;
}

function serveStatic(request, response, url) {
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes.get(ext) || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (await handleApi(request, response, url)) {
    return;
  }
  serveStatic(request, response, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Camera Capture Desk: http://${HOST}:${PORT}/`);
  console.log(`Captures folder: ${CAPTURE_DIR}`);
});
