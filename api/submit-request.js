const { appendToGoogleSheet, sendMail } = require("./integrations");

function json(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function validatePayload(payload) {
  const missing = [];
  if (!payload.employeeId) missing.push("employeeId");
  if (!payload.employeeEmail) missing.push("employeeEmail");
  if (!payload.applicantName) missing.push("applicantName");
  if (!payload.departmentCode) missing.push("departmentCode");
  if (!payload.applyDate) missing.push("applyDate");
  if (!payload.applicantSignature) missing.push("applicantSignature");
  if (!Array.isArray(payload.items) || payload.items.length === 0) missing.push("items");
  return missing;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const missing = validatePayload(payload || {});
    if (missing.length) {
      json(res, 400, { ok: false, error: `Missing required fields: ${missing.join(", ")}` });
      return;
    }

    payload.syncedAt = new Date().toISOString();

    await appendToGoogleSheet(payload);
    await sendMail({
      to: payload.employeeEmail,
      subject: `Purchase request submitted: ${payload.id}`,
      html: `
        <p>Your purchase request has been submitted and entered the approval workflow.</p>
        <p><strong>Request ID:</strong> ${payload.id}</p>
        <p><strong>Status:</strong> ${payload.approvalStatus?.label || "Pending unit manager"}</p>
      `
    });

    json(res, 200, {
      ok: true,
      id: payload.id,
      status: payload.approvalStatus?.label || "Pending unit manager",
    });
  } catch (error) {
    console.error(error);
    json(res, 500, { ok: false, error: error.message || "Internal server error" });
  }
};
