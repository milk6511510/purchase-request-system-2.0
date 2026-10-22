const { json, readBody } = require("./_lib/http");
const { hashPassword } = require("./_lib/security");
const { getSessionUser, getUsers, saveUser, publicUser, isRole } = require("./_lib/domain");

module.exports = async function handler(req, res) {
  try {
    const actor = await getSessionUser(req);
    if (!isRole(actor, "admin")) {
      json(res, 403, { ok: false, error: "只有最高權限管理者可以管理帳號" });
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

    const body = await readBody(req);
    if (!body.employeeId) {
      json(res, 400, { ok: false, error: "請輸入員工編號" });
      return;
    }

    const users = await getUsers();
    const existing = users.find((user) => user.employeeId === String(body.employeeId).trim().toUpperCase());
    const user = await saveUser({
      ...(existing || {}),
      employeeId: String(body.employeeId).trim().toUpperCase(),
      name: String(body.name ?? existing?.name ?? "").trim(),
      email: String(body.email ?? existing?.email ?? "").trim().toLowerCase(),
      departmentCode: String(body.departmentCode ?? existing?.departmentCode ?? "").trim().toUpperCase(),
      role: body.role || existing?.role || "一般使用者",
      active: body.active !== undefined ? Boolean(body.active) : existing?.active !== false,
      passwordHash: body.password ? await hashPassword(String(body.password)) : existing?.passwordHash || "",
      note: String(body.note ?? existing?.note ?? "").trim()
    });

    json(res, 200, { ok: true, user: publicUser(user) });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: error.message || "帳號管理服務暫時無法使用" });
  }
};
