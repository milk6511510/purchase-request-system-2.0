const MAX_BODY_BYTES = 4 * 1024 * 1024;

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const contentLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    const error = new Error("請求資料超過允許大小");
    error.statusCode = 413;
    throw error;
  }

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    let serialized;
    try {
      serialized = JSON.stringify(req.body);
    } catch {
      const error = new Error("請求資料格式無效");
      error.statusCode = 400;
      throw error;
    }
    if (Buffer.byteLength(serialized || "", "utf8") > MAX_BODY_BYTES) {
      const error = new Error("請求資料超過允許大小");
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }

  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      const error = new Error("請求資料超過允許大小");
      error.statusCode = 413;
      throw error;
    }
    try {
      return JSON.parse(rawBody || "{}");
    } catch {
      const error = new Error("請求資料格式無效");
      error.statusCode = 400;
      throw error;
    }
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("請求資料超過允許大小");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("請求資料格式無效");
    error.statusCode = 400;
    throw error;
  }
}

function isSameOrigin(req) {
  const host = String(req.headers?.host || "").trim().toLowerCase();
  const source = String(req.headers?.origin || req.headers?.referer || "").trim();
  if (!host || !source) return false;

  try {
    const url = new URL(source);
    const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
    return url.host.toLowerCase() === host && url.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

function requireSameOrigin(req, res) {
  if (isSameOrigin(req)) return true;
  json(res, 403, { ok: false, error: "請由公司系統頁面送出此操作" });
  return false;
}

function publicErrorMessage(error, fallback) {
  const status = Number(error?.statusCode);
  return status >= 400 && status < 500 && error?.message ? error.message : fallback;
}

function getCookies(req) {
  return String(req.headers?.cookie || "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key]) => key)
    .reduce((cookies, [key, ...value]) => {
      try {
        cookies[key] = decodeURIComponent(value.join("="));
      } catch {
        delete cookies[key];
      }
      return cookies;
    }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.sameSite || options.sameSite === "") parts.push(`SameSite=${options.sameSite}`);
  else parts.push("SameSite=Lax");
  if (process.env.NODE_ENV === "production") parts.push("Secure");

  const existing = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(existing) ? existing : existing ? [existing] : []), parts.join("; ")]);
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0 });
}

module.exports = {
  MAX_BODY_BYTES,
  json,
  readBody,
  getCookies,
  setCookie,
  clearCookie,
  isSameOrigin,
  requireSameOrigin,
  publicErrorMessage
};
