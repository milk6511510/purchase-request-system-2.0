function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function getCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key]) => key)
    .reduce((cookies, [key, ...value]) => {
      cookies[key] = decodeURIComponent(value.join("="));
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

module.exports = { json, readBody, getCookies, setCookie, clearCookie };
