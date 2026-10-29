const { json, readBody } = require("./_lib/http");
const {
  getSessionUser,
  getRequest,
  canEditRequest,
  persistRequest,
  appendApprovalLog
} = require("./_lib/domain");
const { sendMail } = require("./integrations");

function validatePayload(payload) {
  const missing = [];
  if (!payload.applicantSignature) missing.push("申請人簽名");
  if (!Array.isArray(payload.items) || !payload.items.some((item) => String(item.name || "").trim())) {
    missing.push("至少一項品名");
  }
  return missing;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const user = await getSessionUser(req);
    const payload = await readBody(req);
    const missing = validatePayload(payload || {});
    if (missing.length) {
      json(res, 400, { ok: false, error: `請補齊必要資料：${missing.join("、")}` });
      return;
    }

    const existing = payload.id ? await getRequest(payload.id) : null;
    if (existing && !canEditRequest(user, existing)) {
      json(res, 403, { ok: false, error: "此請購單已超過 24 小時或非本人資料，請聯繫 IT" });
      return;
    }

    const now = new Date().toISOString();
    const savedPayload = {
      ...payload,
      id: existing?.id || payload.id || `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      employeeId: user.employeeId,
      employeeEmail: user.email,
      applicantName: payload.applicantName || user.name || user.employeeId,
      departmentCode: payload.departmentCode || user.departmentCode,
      applyDate: payload.applyDate || new Date().toISOString().slice(0, 10),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      approvalStatus: existing?.approvalStatus || {
        currentStep: "unitManager",
        label: "待單位主管簽核",
        route: [
          { step: "applicant", label: "申請人", actor: user.name || user.employeeId, actorEmployeeId: user.employeeId, status: "signed", signedAt: now },
          { step: "unitManager", label: "單位主管", actor: "依部門代號分派", status: "pending", signedAt: "" },
          { step: "generalManager", label: "總經理", actor: "總經理權限", status: "waiting", signedAt: "" }
        ]
      }
    };

    const persisted = await persistRequest(savedPayload);
    await appendApprovalLog({
      request: persisted,
      action: existing ? "已修改" : "已送出",
      actor: user,
      step: existing ? persisted.approvalStatus?.currentStep : "applicant",
      note: existing ? "申請人於 24 小時內修改" : "申請人送出請購單"
    });
    await sendMail({
      to: persisted.employeeEmail,
      subject: `請購單已送出：${persisted.id}`,
      html: `
        <p>請購單已送出，並進入簽核流程。</p>
        <p><strong>請購單號：</strong>${persisted.id}</p>
        <p><strong>狀態：</strong>${persisted.approvalStatus?.label || "待單位主管簽核"}</p>
      `
    });

    json(res, 200, {
      ok: true,
      id: persisted.id,
      status: persisted.approvalStatus?.label || "待單位主管簽核",
      request: persisted
    });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: error.message || "請購單儲存失敗，請稍後再試" });
  }
};
