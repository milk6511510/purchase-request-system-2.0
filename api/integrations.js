const { google } = require("googleapis");
const { Resend } = require("resend");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function optionalEnv(name) {
  return process.env[name] || "";
}

function getGoogleAuth() {
  return new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

function getResendClient() {
  const apiKey = optionalEnv("RESEND_API_KEY");
  return apiKey ? new Resend(apiKey) : null;
}

function compactPayload(payload) {
  return JSON.stringify({
    ...payload,
    photos: (payload.photos || []).map(({ dataUrl, ...photo }) => photo),
    applicantSignature: payload.applicantSignature ? "\u5df2\u7c3d\u540d" : ""
  });
}

function requestRow(payload) {
  return [
    payload.id,
    payload.createdAt,
    payload.updatedAt,
    payload.employeeId,
    payload.employeeEmail,
    payload.applicantName,
    payload.departmentCode,
    payload.requestType,
    payload.applyDate,
    payload.needDate,
    payload.vendorName,
    payload.vendorTaxId,
    payload.taxType,
    payload.totalAmount,
    payload.approvalStatus?.label || "",
    payload.approvalStatus?.currentStep || "",
    payload.categories?.join(", ") || "",
    payload.attachments?.join(", ") || "",
    payload.purpose,
    payload.acceptanceNote,
    payload.photos?.length || 0,
    payload.applicantSignature ? "\u5df2\u7c3d\u540d" : "",
    compactPayload(payload)
  ];
}

function itemRows(payload) {
  return (payload.items || []).map((item, index) => [
    payload.id,
    index + 1,
    item.name || "",
    item.spec || "",
    item.code || "",
    item.unit || "",
    item.qty || "",
    item.approvedQty || "",
    item.price || "",
    item.amount || "",
    item.note || ""
  ]);
}

function approvalRows(payload) {
  const route = payload.approvalStatus?.route || [];
  return route.map((step) => [
    payload.id,
    step.signedAt || payload.createdAt || new Date().toISOString(),
    step.step || "",
    step.status || "",
    step.actorEmployeeId || "",
    step.actor || "",
    step.actorEmail || "",
    step.note || step.label || "",
    payload.employeeEmail || ""
  ]);
}

async function appendValues(sheets, spreadsheetId, range, values) {
  if (!values.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function appendToGoogleSheet(payload) {
  const sheets = getSheetsClient();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");

  await appendValues(sheets, spreadsheetId, "\u8acb\u8cfc\u4e3b\u8868!A:W", [requestRow(payload)]);
  await appendValues(sheets, spreadsheetId, "\u54c1\u9805\u660e\u7d30!A:K", itemRows(payload));
  await appendValues(sheets, spreadsheetId, "\u7c3d\u6838\u7d00\u9304!A:I", approvalRows(payload));
}

async function sendMail({ to, subject, html }) {
  const resend = getResendClient();
  if (!resend || !to) return { skipped: true };

  await resend.emails.send({
    from: optionalEnv("MAIL_FROM") || "Purchase Request System <noreply@example.com>",
    to,
    subject,
    html
  });

  return { skipped: false };
}

module.exports = {
  appendToGoogleSheet,
  sendMail
};
