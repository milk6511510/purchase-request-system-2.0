const { google } = require("googleapis");
const { Readable } = require("node:stream");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getGoogleAuth() {
  return new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getGoogleAuth() });
}

function getDriveClient() {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}

function spreadsheetId() {
  return requiredEnv("GOOGLE_SHEET_ID");
}

function columnLetter(number) {
  let result = "";
  let value = number;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

async function getSheetRows(tabName) {
  const sheets = getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A:AZ`,
    majorDimension: "ROWS"
  });
  const values = response.data.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1).map((values, index) => {
    const row = { _rowNumber: index + 2 };
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex] ?? "";
    });
    return row;
  });
  return { sheets, headers, rows };
}

async function ensureHeaders(tabName, requiredHeaders) {
  const current = await getSheetRows(tabName);
  const headers = [...current.headers];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (!missing.length) return current;

  headers.push(...missing);
  await current.sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A1:${columnLetter(headers.length)}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] }
  });
  return getSheetRows(tabName);
}

async function writeRow(tabName, rowNumber, headers, object) {
  const sheets = getSheetsClient();
  const values = headers.map((header) => normalizeCellValue(header, object[header]));
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] }
  });
}

async function appendRow(tabName, headers, object) {
  const sheets = getSheetsClient();
  const values = headers.map((header) => normalizeCellValue(header, object[header]));
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A:${columnLetter(headers.length)}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] }
  });
}

const NUMERIC_HEADERS = new Set(["合計金額", "申購數量", "核准數量", "單價", "金額"]);

function normalizeCellValue(header, value) {
  if (value === undefined || value === null || value === "") return "";
  if (NUMERIC_HEADERS.has(header)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : "";
  }
  return typeof value === "string" ? value : value;
}

async function upsertRow(tabName, requiredHeaders, identityHeader, identityValue, object) {
  const current = await ensureHeaders(tabName, requiredHeaders);
  const existing = current.rows.find((row) => String(row[identityHeader] || "") === String(identityValue));
  if (existing) {
    await writeRow(tabName, existing._rowNumber, current.headers, object);
    return existing._rowNumber;
  }
  await appendRow(tabName, current.headers, object);
  return null;
}

async function clearRowsByValue(tabName, identityHeader, identityValue) {
  const current = await getSheetRows(tabName);
  const sheets = current.sheets;
  const matching = current.rows.filter((row) => String(row[identityHeader] || "") === String(identityValue));
  await Promise.all(matching.map((row) => sheets.spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A${row._rowNumber}:${columnLetter(current.headers.length)}${row._rowNumber}`
  })));
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  const encoded = match[2];
  if (encoded.length % 4 !== 0) return null;
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > 512 * 1024 || buffer.toString("base64") !== encoded) return null;
  const mimeType = match[1].toLowerCase();
  const isPng = mimeType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = mimeType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = mimeType === "image/webp" && buffer.subarray(0, 4).toString() === "RIFF"
    && buffer.subarray(8, 12).toString() === "WEBP";
  if (!isPng && !isJpeg && !isWebp) return null;
  return { mimeType, buffer };
}

async function uploadDataUrl({ dataUrl, fileName, folderId }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !folderId) return null;
  const drive = getDriveClient();
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: parsed.mimeType
    },
    media: {
      mimeType: parsed.mimeType,
      body: Readable.from(parsed.buffer)
    },
    fields: "id,name,webViewLink,webContentLink"
  });
  return response.data;
}

module.exports = {
  requiredEnv,
  getSheetsClient,
  getDriveClient,
  getSheetRows,
  ensureHeaders,
  normalizeCellValue,
  writeRow,
  appendRow,
  upsertRow,
  clearRowsByValue,
  parseDataUrl,
  uploadDataUrl
};
