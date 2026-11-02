const { json, readBody, requireSameOrigin, publicErrorMessage } = require("./_lib/http");
const {
  getSessionUser,
  getRequest,
  canApprove,
  isRole,
  persistRequest,
  appendApprovalLog
} = require("./_lib/domain");
const { sendMail, escapeHtml } = require("./integrations");

function actionLabel(action) {
  return {
    approve: "已核准",
    reject: "已退回",
    cancel: "已註銷"
  }[action] || "已更新";
}

function nextApprovalStatus(request, action, actor) {
  const now = new Date().toISOString();
  const currentStep = request.approvalStatus?.currentStep || "unitManager";
  const route = Array.isArray(request.approvalStatus?.route)
    ? request.approvalStatus.route.map((step) => ({ ...step }))
    : [];
  const current = route.find((step) => step.step === currentStep);

  if (current) {
    current.status = action === "approve" ? "approved" : action;
    current.actorEmployeeId = actor.employeeId;
    current.actor = actor.name || actor.employeeId;
    current.actorEmail = actor.email || "";
    current.signedAt = now;
  }

  if (action === "reject" || action === "cancel") {
    return { label: actionLabel(action), currentStep: "closed", route };
  }

  if (currentStep === "unitManager") {
    const generalManager = route.find((step) => step.step === "generalManager");
    if (generalManager) {
      generalManager.status = "pending";
      return { label: "待總經理簽核", currentStep: "generalManager", route };
    }
  }

  return { label: "已核准", currentStep: "closed", route };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    if (!requireSameOrigin(req, res)) return;

    const actor = await getSessionUser(req);
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      json(res, 400, { ok: false, error: "簽核資料格式無效" });
      return;
    }
    const action = String(body.action || "").trim();
    const requestId = String(body.id || "");
    if (!requestId || requestId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(requestId)
      || !["approve", "reject", "cancel"].includes(action)) {
      json(res, 400, { ok: false, error: "請提供有效的請購單號與簽核動作" });
      return;
    }
    const note = String(body.note || "").trim();
    if (note.length > 1000) {
      json(res, 400, { ok: false, error: "簽核說明不可超過 1000 個字元" });
      return;
    }

    const request = await getRequest(requestId);
    if (!request) {
      json(res, 404, { ok: false, error: "找不到請購單" });
      return;
    }

    if (action === "cancel") {
      const allowed = isRole(actor, "admin") || actor.employeeId === request.employeeId;
      if (!allowed) {
        json(res, 403, { ok: false, error: "只有申請人或最高權限管理者可以註銷" });
        return;
      }
    } else if (!canApprove(actor, request)) {
      json(res, 403, { ok: false, error: "目前簽核關卡與你的權限不符" });
      return;
    }

    const updated = await persistRequest({
      ...request,
      updatedAt: new Date().toISOString(),
      approvalStatus: nextApprovalStatus(request, action, actor)
    });
    await appendApprovalLog({
      request: updated,
      action: actionLabel(action),
      actor,
      step: request.approvalStatus?.currentStep || "",
      note
    });

    if (action === "reject" || action === "cancel") {
      await sendMail({
        to: request.employeeEmail,
        subject: `請購單${actionLabel(action)}：${request.id}`,
        html: `
          <p>你的請購單狀態已更新。</p>
          <p><strong>請購單號：</strong>${escapeHtml(request.id)}</p>
          <p><strong>狀態：</strong>${escapeHtml(actionLabel(action))}</p>
          <p><strong>處理人：</strong>${escapeHtml(actor.name || actor.employeeId)}</p>
          <p><strong>說明：</strong>${escapeHtml(note || "未提供說明")}</p>
        `
      });
    }

    json(res, 200, { ok: true, id: updated.id, status: updated.approvalStatus.label, request: updated });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: publicErrorMessage(error, "簽核服務暫時無法使用") });
  }
};
