const { google } = require("googleapis");
const { Client } = require("@notionhq/client");
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

function getNotionClient() {
  return new Client({ auth: requiredEnv("NOTION_TOKEN") });
}

function getResendClient() {
  const apiKey = optionalEnv("RESEND_API_KEY");
  return apiKey ? new Resend(apiKey) : null;
}

function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeItems(items = []) {
  return items
    .map((item, index) => {
      const qty = item.qty || "0";
      const unit = item.unit || "";
      const price = item.price || "0";
      const amount = item.amount || "0";
      return `${index + 1}. ${item.name || "未命名品項"} ${qty}${unit} x ${price} = ${amount}`;
    })
    .join("\n");
}

function notionTitle(value) {
  return { title: [{ text: { content: text(value || "未命名請購單").slice(0, 2000) } }] };
}

function notionRichText(value) {
  return { rich_text: [{ text: { content: text(value).slice(0, 2000) } }] };
}

function notionSelect(value) {
  return value ? { select: { name: text(value).slice(0, 100) } } : undefined;
}

function notionDate(value) {
  return value ? { date: { start: value } } : undefined;
}

function notionEmail(value) {
  return value ? { email: text(value) } : undefined;
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
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
    payload.applicantSignature ? "已簽名" : "未簽名",
    payload.notionPageUrl || "",
    JSON.stringify(payload)
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
    step.note || "",
    payload.employeeEmail || "",
    payload.notionPageUrl || ""
  ]);
}

async function appendToGoogleSheet(payload) {
  const sheets = getSheetsClient();
  const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");

  await appendValues(sheets, spreadsheetId, "請購主表!A:X", [requestRow(payload)]);
  await appendValues(sheets, spreadsheetId, "品項明細!A:K", itemRows(payload));
  await appendValues(sheets, spreadsheetId, "簽核紀錄!A:J", approvalRows(payload));
}

async function createNotionPage(payload) {
  const notion = getNotionClient();
  const response = await notion.pages.create({
    parent: { database_id: requiredEnv("NOTION_DATABASE_ID") },
    properties: compactProperties({
      "單號": notionTitle(payload.id),
      "申請人": notionRichText(payload.applicantName),
      "員工編號": notionRichText(payload.employeeId),
      "公司信箱": notionEmail(payload.employeeEmail),
      "部門代號": notionRichText(payload.departmentCode),
      "申請類型": notionSelect(payload.requestType),
      "申請日期": notionDate(payload.applyDate),
      "須用日期": notionDate(payload.needDate),
      "廠商名稱": notionRichText(payload.vendorName),
      "合計金額": { number: number(payload.totalAmount) },
      "簽核狀態": notionSelect(payload.approvalStatus?.label || "待單位主管簽核"),
      "目前關卡": notionRichText(payload.approvalStatus?.currentStep || "unitManager"),
      "照片數": { number: payload.photos?.length || 0 }
    }),
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "品項明細" } }] }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: summarizeItems(payload.items).slice(0, 2000) || "無品項" } }] }
      },
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: "用途說明" } }] }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: text(payload.purpose).slice(0, 2000) || "未填寫用途說明" } }] }
      }
    ]
  });

  return response;
}

async function sendMail({ to, subject, html }) {
  const resend = getResendClient();
  if (!resend || !to) return { skipped: true };

  await resend.emails.send({
    from: optionalEnv("MAIL_FROM") || "請購單系統 <noreply@example.com>",
    to,
    subject,
    html
  });

  return { skipped: false };
}

module.exports = {
  appendToGoogleSheet,
  createNotionPage,
  sendMail,
  summarizeItems
};
