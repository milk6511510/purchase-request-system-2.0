const { json, readBody, requireSameOrigin, publicErrorMessage } = require("./_lib/http");
const { hashPassword } = require("./_lib/security");
const {
  getSessionUser,
  getUsers,
  saveUser,
  publicUser,
  isRole,
  normalizeSystemRole,
  normalizeApprovalRole
} = require("./_lib/domain");

module.exports = async function handler(req, res) {
  try {
    const actor = await getSessionUser(req);
    if (!isRole(actor, "superAdmin")) {
      json(res, 403, { ok: false, error: "只有最高權限者可以管理帳號與指派權限" });
      return;
    }

    if (req.method === "GET") {
      const users = await getUsers();
      json(res, 200, { ok: true, users: users.map(publicUser) });
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    if (!requireSameOrigin(req, res)) return;

    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      json(res, 400, { ok: false, error: "帳號資料格式無效" });
      return;
    }
    if (!body.employeeId || typeof body.employeeId !== "string") {
      json(res, 400, { ok: false, error: "請輸入員工編號" });
      return;
    }

    const users = await getUsers();
    const employeeId = body.employeeId.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(employeeId)) {
      json(res, 400, { ok: false, error: "員工編號格式無效" });
      return;
    }
    const existing = users.find((user) => user.employeeId === employeeId);
    const name = String(body.name ?? existing?.name ?? "").trim();
    const email = String(body.email ?? existing?.email ?? "").trim().toLowerCase();
    const note = String(body.note ?? existing?.note ?? "").trim();
    const role = body.role !== undefined ? String(body.role) : existing?.role || "user";
    const approvalRole = body.approvalRole !== undefined ? String(body.approvalRole) : existing?.approvalRole || "";
    const password = String(body.password || "");
    if (name.length > 120 || email.length > 254
      || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      json(res, 400, { ok: false, error: "姓名或公司信箱格式無效" });
      return;
    }
    if (note.length > 1000) {
      json(res, 400, { ok: false, error: "備註不可超過 1000 個字元" });
      return;
    }
    if (body.departmentCode !== undefined && (typeof body.departmentCode !== "string" || body.departmentCode.length > 32)) {
      json(res, 400, { ok: false, error: "部門代號格式無效" });
      return;
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      json(res, 400, { ok: false, error: "帳號啟用狀態格式無效" });
      return;
    }
    if (password.length > 128) {
      json(res, 400, { ok: false, error: "臨時密碼不可超過 128 個字元" });
      return;
    }
    if (!new Set(["user", "manager", "superAdmin"]).has(role)) {
      json(res, 400, { ok: false, error: "系統權限設定無效" });
      return;
    }
    if (!new Set(["", "unitManager", "generalManager"]).has(approvalRole)) {
      json(res, 400, { ok: false, error: "簽核職務設定無效" });
      return;
    }
    if (employeeId === actor.employeeId && role !== "superAdmin") {
      json(res, 400, { ok: false, error: "不能移除自己唯一的最高權限者身分" });
      return;
    }
    const deactivating = body.active === false;
    if (existing && isRole(existing, "superAdmin") && (role !== "superAdmin" || deactivating)
      && users.filter((user) => user.active && isRole(user, "superAdmin")).length <= 1) {
      json(res, 400, { ok: false, error: "至少須保留一位啟用中的最高權限者" });
      return;
    }
    if (password && password.length < 8) {
      json(res, 400, { ok: false, error: "臨時密碼至少需要 8 個字元" });
      return;
    }
    if (password && password !== String(body.confirmPassword || "")) {
      json(res, 400, { ok: false, error: "兩次輸入的臨時密碼不一致" });
      return;
    }
    if ((!existing?.passwordHash || !existing) && !password) {
      json(res, 400, { ok: false, error: "建立員工帳號時必須設定臨時密碼" });
      return;
    }
    if ((!existing || !existing.passwordHash) && (!name || !email)) {
      json(res, 400, { ok: false, error: "建立帳號時請填寫姓名與公司信箱" });
      return;
    }
    const emailOwner = users.find((user) => user.employeeId !== employeeId && String(user.email || "").toLowerCase() === email);
    if (email && emailOwner) {
      json(res, 409, { ok: false, error: "此公司信箱已綁定其他員工帳號" });
      return;
    }
    const user = await saveUser({
      ...(existing || {}),
      employeeId,
      name,
      email,
      departmentCode: String(body.departmentCode ?? existing?.departmentCode ?? "").trim().toUpperCase(),
      role: normalizeSystemRole(role),
      approvalRole: normalizeApprovalRole(approvalRole),
      active: body.active !== undefined ? body.active : existing?.active !== false,
      mustChangePassword: password ? true : existing?.mustChangePassword === true,
      passwordHash: password ? await hashPassword(password) : existing?.passwordHash || "",
      note
    });

    json(res, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: publicErrorMessage(error, "帳號管理服務暫時無法使用") });
  }
};
