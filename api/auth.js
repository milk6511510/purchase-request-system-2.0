const { json, readBody, setCookie, clearCookie } = require("./_lib/http");
const { hashPassword, verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS } = require("./_lib/security");
const { getUser, saveUser, publicUser } = require("./_lib/domain");

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
    name: "李柏勳",
    email: process.env.ADMIN_EMAIL || "",
    departmentCode: "ADMIN",
    role: "superAdmin",
    active: true,
    mustChangePassword: process.env.ADMIN_INITIAL_FORCE_CHANGE !== "false",
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

async function changePassword(body, req, res) {
  const user = await require("./_lib/domain").getSessionUser(req, true);
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!currentPassword || !newPassword) {
    json(res, 400, { ok: false, error: "請輸入目前密碼與新密碼" });
    return;
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    json(res, 401, { ok: false, error: "目前密碼不正確" });
    return;
  }
  if (newPassword.length < 8) {
    json(res, 400, { ok: false, error: "新密碼至少需要 8 個字元" });
    return;
  }
  if (newPassword !== String(body.confirmPassword || "")) {
    json(res, 400, { ok: false, error: "兩次輸入的新密碼不一致" });
    return;
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    json(res, 400, { ok: false, error: "新密碼不可與目前密碼相同" });
    return;
  }

  const updated = await saveUser({
    ...user,
    mustChangePassword: false,
    passwordHash: await hashPassword(newPassword)
  });
  json(res, 200, { ok: true, user: publicUser(updated) });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { getSessionUser } = require("./_lib/domain");
      const user = await getSessionUser(req, true);
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
    if (body.action === "changePassword") {
      await changePassword(body, req, res);
      return;
    }
    if (body.action === "register") {
      json(res, 403, { ok: false, error: "目前不開放員工自行註冊，請洽最高權限者建立帳號並核發臨時密碼。" });
      return;
    }
    await login(body, res);
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: error.message || "登入服務暫時無法使用" });
  }
};
