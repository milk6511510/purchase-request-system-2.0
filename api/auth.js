const { json, readBody, setCookie, clearCookie } = require("./_lib/http");
const { hashPassword, verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } = require("./_lib/security");
const { getUser, saveUser, publicUser } = require("./_lib/domain");

function emailAllowed(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const domain = String(process.env.COMPANY_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, "");
  if (!domain) return process.env.NODE_ENV !== "production";
  return normalized.endsWith(`@${domain}`);
}

function normalizeEmployeeId(value) {
  return String(value || "").trim().toUpperCase();
}

async function ensureAdminBootstrap() {
  const employeeId = normalizeEmployeeId(process.env.ADMIN_EMPLOYEE_ID || "A001");
  const existing = await getUser(employeeId);
  if (existing) return existing;

  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!initialPassword) return null;
  return saveUser({
    employeeId,
    name: "系統管理者",
    email: process.env.ADMIN_EMAIL || "",
    departmentCode: "ADMIN",
    role: "最高權限",
    active: true,
    passwordHash: await hashPassword(initialPassword),
    note: "由環境變數建立的初始最高權限帳號"
  });
}

async function login(body, res) {
  const employeeId = normalizeEmployeeId(body.employeeId);
  const password = String(body.password || "");
  if (!employeeId || !password) {
    json(res, 400, { ok: false, error: "請輸入員工編號與密碼" });
    return;
  }

  let user = await getUser(employeeId);
  if (!user && employeeId === normalizeEmployeeId(process.env.ADMIN_EMPLOYEE_ID || "A001")) {
    user = await ensureAdminBootstrap();
  }
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    json(res, 401, { ok: false, error: "員工編號或密碼錯誤，或帳號尚未啟用" });
    return;
  }

  setCookie(res, SESSION_COOKIE, createSession(user.employeeId), { maxAge: SESSION_TTL_SECONDS });
  json(res, 200, { ok: true, user: publicUser(user) });
}

async function register(body, res) {
  const employeeId = normalizeEmployeeId(body.employeeId);
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");

  if (!employeeId || !email || !password) {
    json(res, 400, { ok: false, error: "請填寫員工編號、公司信箱與密碼" });
    return;
  }
  if (!emailAllowed(email)) {
    json(res, 400, { ok: false, error: "請使用公司信箱註冊" });
    return;
  }

  const existing = await getUser(employeeId);
  if (existing?.passwordHash) {
    json(res, 409, { ok: false, error: "此員工編號已完成註冊，請直接登入" });
    return;
  }
  if (existing?.email && existing.email.toLowerCase() !== email) {
    json(res, 403, { ok: false, error: "此員工編號已綁定其他公司信箱，請聯繫 IT" });
    return;
  }

  const active = existing ? existing.active : process.env.SELF_REGISTER_AUTO_ACTIVATE === "true";
  const user = await saveUser({
    ...(existing || {}),
    employeeId,
    name: name || existing?.name || "",
    email,
    departmentCode: existing?.departmentCode || "",
    role: existing?.role || "一般使用者",
    active,
    passwordHash: await hashPassword(password),
    note: existing?.note || (active ? "首次註冊" : "等待最高權限管理者啟用")
  });

  if (!user.active) {
    json(res, 202, { ok: true, pending: true, message: "註冊完成，請等待最高權限管理者啟用帳號" });
    return;
  }

  setCookie(res, SESSION_COOKIE, createSession(user.employeeId), { maxAge: SESSION_TTL_SECONDS });
  json(res, 200, { ok: true, user: publicUser(user) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { getSessionUser } = require("./_lib/domain");
      const user = await getSessionUser(req);
      json(res, 200, { ok: true, user: publicUser(user) });
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const body = await readBody(req);
    if (body.action === "logout") {
      clearCookie(res, SESSION_COOKIE);
      json(res, 200, { ok: true });
      return;
    }
    if (body.action === "register") {
      await register(body, res);
      return;
    }
    await login(body, res);
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: error.message || "登入服務暫時無法使用" });
  }
};
