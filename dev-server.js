const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnvironment();

const routes = {
  auth: require("./api/auth"),
  users: require("./api/users"),
  requests: require("./api/requests"),
  "submit-request": require("./api/submit-request"),
  "approval-action": require("./api/approval-action")
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;

  if (pathname.startsWith("/api/")) {
    const name = pathname.slice("/api/".length);
    const handler = routes[name];
    if (!handler) return sendJson(res, 404, { ok: false, error: "找不到 API" });
    try {
      await handler(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, error.statusCode || 500, { ok: false, error: "後端服務暫時無法使用" });
    }
    return;
  }

  if (pathname === "/assets/aiwa-logo.svg" && (req.method === "GET" || req.method === "HEAD")) {
    try {
      const logo = await fs.promises.readFile(path.join(__dirname, "assets", "aiwa-logo.svg"));
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8" });
      return res.end(req.method === "HEAD" ? undefined : logo);
    } catch (error) {
      console.error(error);
      res.writeHead(404);
      return res.end("Not found");
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  if (pathname !== "/" && pathname !== "/purchase_request_form.html") {
    res.writeHead(404);
    return res.end("Not found");
  }

  try {
    const html = await fs.promises.readFile(path.join(__dirname, "purchase_request_form.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Unable to load the purchase request page");
  }
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 8788;
server.listen(port, host, () => {
  process.stdout.write(`本機預覽：http://${host}:${port}/purchase_request_form.html\n`);
});

module.exports = server;
