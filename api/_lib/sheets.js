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
  const values = headers.map((header) => object[header] ?? "");
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] }
  });
}

async function appendRow(tabName, headers, object) {
  const sheets = getSheetsClient();
  const values = headers.map((header) => object[header] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${tabName}!A:${columnLetter(headers.length)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] }
  });
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
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
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
  writeRow,
  appendRow,
  upsertRow,
  clearRowsByValue,
  uploadDataUrl
};
