const { appendToGoogleSheet, sendMail } = require("./integrations");

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function actionLabel(action) {
  return {
    approve: "Approved",
    reject: "Rejected",
    cancel: "Cancelled"
  }[action] || "Updated";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { request, action, actorEmployeeId, actorName, actorEmail, note } = body || {};

    if (!request?.id || !action || !actorEmployeeId) {
      json(res, 400, { ok: false, error: "Missing request, action, or actorEmployeeId" });
      return;
    }

    const label = actionLabel(action);
    const actionPayload = {
      ...request,
      id: request.id,
      updatedAt: new Date().toISOString(),
      approvalStatus: {
        ...(request.approvalStatus || {}),
        label,
        currentStep: action === "approve" ? "next" : "closed",
        route: [
          {
            step: request.approvalStatus?.currentStep || "approval",
            status: action,
            actorEmployeeId,
            actor: actorName || actorEmployeeId,
            actorEmail: actorEmail || "",
            note: note || "",
            signedAt: new Date().toISOString()
          }
        ]
      }
    };

    await appendToGoogleSheet(actionPayload);

    if (action === "reject" || action === "cancel") {
      await sendMail({
        to: request.employeeEmail,
        subject: `Purchase request ${label}: ${request.id}`,
        html: `
          <p>Your purchase request status has changed.</p>
          <p><strong>Request ID:</strong> ${request.id}</p>
          <p><strong>Status:</strong> ${label}</p>
          <p><strong>Reviewer:</strong> ${actorName || actorEmployeeId}</p>
          <p><strong>Note:</strong> ${note || "No note provided"}</p>
        `
      });
    }

    json(res, 200, { ok: true, id: request.id, status: label });
  } catch (error) {
    console.error(error);
    json(res, 500, { ok: false, error: error.message || "Internal server error" });
  }
};
