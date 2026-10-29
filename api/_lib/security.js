const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "purchase_request_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function hashPassword(password, minimumLength = 8) {
  if (!password || password.length < minimumLength) throw new Error(`密碼至少需要 ${minimumLength} 個字元`);
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [algorithm, salt, expectedHex] = String(storedHash).split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function sessionSecret() {
  return requiredEnv("AUTH_SECRET");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function createSession(employeeId) {
  const payload = Buffer.from(JSON.stringify({
    employeeId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(token) {
  if (!token) return null;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.employeeId || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  hashPassword,
  verifyPassword,
  createSession,
  readSession
};
