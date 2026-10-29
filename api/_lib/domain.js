const { getCookies } = require("./http");
const { readSession, SESSION_COOKIE } = require("./security");
const {
  getSheetRows,
  upsertRow,
  appendRow,
  clearRowsByValue,
  uploadDataUrl
} = require("./sheets");

const USER_HEADERS = [
  "員工編號", "姓名", "公司信箱", "部門代號", "權限", "簽核職務", "啟用", "首次登入須改密碼", "建立時間", "更新時間", "備註", "密碼雜湊"
];

const REQUEST_HEADERS = [
  "單號", "建立時間", "更新時間", "員工編號", "公司信箱", "申請人", "部門代號", "申請類型",
  "申請日期", "須用日期", "廠商名稱", "統一編號", "稅別", "合計金額", "簽核狀態", "目前關卡",
  "類別", "檢附資料", "用途說明", "驗收/其他說明", "照片數", "簽名狀態", "原始資料"
];

const ITEM_HEADERS = [
  "單號", "項次", "品項名稱", "規格", "品項編號", "單位", "申購數量", "核准數量", "單價", "金額", "備註"
];

const APPROVAL_HEADERS = [
  "單號", "動作時間", "關卡", "動作", "簽核人工號", "簽核人", "簽核人信箱", "說明", "通知信箱"
];

class AuthError extends Error {
  constructor(message = "未登入或登入已過期") {
    super(message);
    this.name = "AuthError";
    this.statusCode = 401;
  }
}

function isActive(value) {
  return value === true || value === "TRUE" || value === "true" || value === 1 || value === "1";
}

function normalizeSystemRole(value) {
  const role = String(value || "").trim();
  if (["superAdmin", "admin", "最高權限", "最高權限管理者", "最高權限者"].includes(role)) return "superAdmin";
  if (["manager", "管理者", "generalManager", "總經理"].includes(role)) return "manager";
  return "user";
}

function normalizeApprovalRole(value, fallbackRole = "") {
  const role = String(value || "").trim();
  const fallback = String(fallbackRole || "").trim();
  if (["unitManager", "單位主管"].includes(role) || ["unitManager", "單位主管"].includes(fallback)) return "unitManager";
  if (["generalManager", "總經理"].includes(role) || ["generalManager", "總經理"].includes(fallback)) return "generalManager";
  return "";
}

function normalizeUserRoles(user = {}) {
  return {
    role: normalizeSystemRole(user.role),
    approvalRole: normalizeApprovalRole(user.approvalRole, user.role)
  };
}

function userFromRow(row) {
  const roles = normalizeUserRoles({ role: row["權限"], approvalRole: row["簽核職務"] });
  return {
    employeeId: String(row["員工編號"] || "").trim(),
    name: String(row["姓名"] || "").trim(),
    email: String(row["公司信箱"] || "").trim(),
    departmentCode: String(row["部門代號"] || "").trim().toUpperCase(),
    ...roles,
    active: isActive(row["啟用"]),
    mustChangePassword: isActive(row["首次登入須改密碼"]),
    createdAt: row["建立時間"] || "",
    updatedAt: row["更新時間"] || "",
    note: row["備註"] || "",
    passwordHash: row["密碼雜湊"] || "",
    _rowNumber: row._rowNumber
  };
}

function userToRow(user) {
  return {
    "員工編號": user.employeeId,
    "姓名": user.name || "",
    "公司信箱": user.email || "",
    "部門代號": user.departmentCode || "",
    "權限": normalizeSystemRole(user.role),
    "簽核職務": normalizeApprovalRole(user.approvalRole, user.role),
    "啟用": user.active !== false,
    "首次登入須改密碼": user.mustChangePassword === true,
    "建立時間": user.createdAt || new Date().toISOString(),
    "更新時間": user.updatedAt || new Date().toISOString(),
    "備註": user.note || "",
    "密碼雜湊": user.passwordHash || ""
  };
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, _rowNumber, ...safe } = user;
  return safe;
}

async function getUsers() {
  const { rows } = await getSheetRows("使用者權限");
  return rows.map(userFromRow).filter((user) => user.employeeId);
}

async function getUser(employeeId) {
  const users = await getUsers();
  return users.find((user) => user.employeeId.toUpperCase() === String(employeeId || "").trim().toUpperCase()) || null;
}

async function saveUser(user) {
  const normalized = {
    ...user,
    employeeId: String(user.employeeId || "").trim().toUpperCase(),
    ...normalizeUserRoles(user),
    active: user.active !== false,
    updatedAt: new Date().toISOString()
  };
  await upsertRow("使用者權限", USER_HEADERS, "員工編號", normalized.employeeId, userToRow(normalized));
  return getUser(normalized.employeeId);
}

function rowToRequest(row) {
  let payload = {};
  try {
    payload = row["原始資料"] ? JSON.parse(row["原始資料"]) : {};
  } catch {
    payload = {};
  }

  return {
    ...payload,
    id: payload.id || row["單號"],
    createdAt: payload.createdAt || row["建立時間"],
    updatedAt: payload.updatedAt || row["更新時間"],
    employeeId: payload.employeeId || row["員工編號"],
    employeeEmail: payload.employeeEmail || row["公司信箱"],
    applicantName: payload.applicantName || row["申請人"],
    departmentCode: payload.departmentCode || row["部門代號"],
    totalAmount: payload.totalAmount ?? row["合計金額"],
    approvalStatus: payload.approvalStatus || {
      label: row["簽核狀態"],
      currentStep: row["目前關卡"],
      route: []
    },
    photos: payload.photos || [],
    _sheetRowNumber: row._rowNumber
  };
}

async function getRequests() {
  const { rows } = await getSheetRows("請購主表");
  return rows.map(rowToRequest).filter((request) => request.id);
}

async function getRequest(id) {
  const requests = await getRequests();
  return requests.find((request) => request.id === id) || null;
}

function roleName(role) {
  return {
    user: "一般員工",
    manager: "管理者",
    superAdmin: "最高權限者",
    admin: "最高權限者",
    "一般使用者": "一般員工",
    "一般員工": "一般員工",
    "管理者": "管理者",
    "最高權限": "最高權限者",
    "最高權限管理者": "最高權限者",
    "最高權限者": "最高權限者"
  }[role] || role || "一般員工";
}

function isRole(user, ...roles) {
  const normalized = normalizeUserRoles(user || {});
  return roles.some((role) => {
    const value = String(role || "").trim();
    if (["unitManager", "單位主管"].includes(value)) return normalized.approvalRole === "unitManager";
    if (["generalManager", "總經理"].includes(value)) return normalized.approvalRole === "generalManager";
    return normalizeSystemRole(value) === normalized.role;
  });
}

function canReadRequest(user, request) {
  if (!user || !request) return false;
  if (isRole(user, "superAdmin", "manager", "generalManager")) return true;
  if (isRole(user, "unitManager")) {
    return String(user.departmentCode || "").toUpperCase() === String(request.departmentCode || "").toUpperCase();
  }
  return user.employeeId === request.employeeId;
}

function canEditRequest(user, request) {
  if (!canReadRequest(user, request)) return false;
  if (isRole(user, "superAdmin")) return true;
  const createdAt = new Date(request.createdAt).getTime();
  return user.employeeId === request.employeeId
    && Number.isFinite(createdAt)
    && Date.now() - createdAt >= 0
    && Date.now() - createdAt <= 24 * 60 * 60 * 1000;
}

function canApprove(user, request) {
  if (isRole(user, "superAdmin")) return true;
  const currentStep = request.approvalStatus?.currentStep;
  if (currentStep === "unitManager" && isRole(user, "unitManager")) {
    return String(user.departmentCode || "").toUpperCase() === String(request.departmentCode || "").toUpperCase();
  }
  return currentStep === "generalManager" && isRole(user, "generalManager");
}

async function getSessionUser(req, allowPasswordChange = false) {
  const cookies = getCookies(req);
  const session = readSession(cookies[SESSION_COOKIE]);
  if (!session) throw new AuthError();
  const user = await getUser(session.employeeId);
  if (!user || !user.active) throw new AuthError("帳號尚未啟用或已停用");
  if (user.mustChangePassword && !allowPasswordChange) {
    const error = new AuthError("首次登入請先修改密碼");
    error.statusCode = 403;
    throw error;
  }
  return user;
}

function compactPayload(payload) {
  return JSON.stringify({
    ...payload,
    photos: (payload.photos || []).map(({ dataUrl, ...photo }) => photo),
    applicantSignature: payload.applicantSignature ? "已簽名" : ""
  });
}

function requestToRow(payload) {
  return {
    "單號": payload.id,
    "建立時間": payload.createdAt,
    "更新時間": payload.updatedAt,
    "員工編號": payload.employeeId,
    "公司信箱": payload.employeeEmail,
    "申請人": payload.applicantName,
    "部門代號": payload.departmentCode,
    "申請類型": payload.requestType,
    "申請日期": payload.applyDate,
    "須用日期": payload.needDate,
    "廠商名稱": payload.vendorName,
    "統一編號": payload.vendorTaxId,
    "稅別": payload.taxType,
    "合計金額": payload.totalAmount,
    "簽核狀態": payload.approvalStatus?.label || "",
    "目前關卡": payload.approvalStatus?.currentStep || "",
    "類別": (payload.categories || []).join(", "),
    "檢附資料": (payload.attachments || []).join(", "),
    "用途說明": payload.purpose,
    "驗收/其他說明": payload.acceptanceNote,
    "照片數": payload.photos?.length || 0,
    "簽名狀態": payload.applicantSignature ? "已簽名" : "",
    "原始資料": compactPayload(payload)
  };
}

async function uploadRequestFiles(payload) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  if (!folderId) return payload;

  const photos = [];
  for (const photo of payload.photos || []) {
    const file = await uploadDataUrl({
      dataUrl: photo.dataUrl,
      fileName: `${payload.id}-${photo.name || "photo.jpg"}`,
      folderId
    });
    photos.push({ ...photo, dataUrl: "", fileId: file?.id || "", fileUrl: file?.webViewLink || "" });
  }

  let applicantSignature = payload.applicantSignature;
  let signatureFile = null;
  if (payload.applicantSignature) {
    signatureFile = await uploadDataUrl({
      dataUrl: payload.applicantSignature,
      fileName: `${payload.id}-applicant-signature.png`,
      folderId
    });
    applicantSignature = signatureFile?.webViewLink || "已簽名";
  }

  return {
    ...payload,
    photos,
    applicantSignature,
    signatureFileId: signatureFile?.id || payload.signatureFileId || ""
  };
}

async function persistRequest(payload) {
  const enriched = await uploadRequestFiles(payload);
  await upsertRow("請購主表", REQUEST_HEADERS, "單號", enriched.id, requestToRow(enriched));
  await clearRowsByValue("品項明細", "單號", enriched.id);
  for (const [index, item] of (enriched.items || []).entries()) {
    await appendRow("品項明細", ITEM_HEADERS, {
      "單號": enriched.id,
      "項次": index + 1,
      "品項名稱": item.name || "",
      "規格": item.spec || "",
      "品項編號": item.code || "",
      "單位": item.unit || "",
      "申購數量": item.qty || "",
      "核准數量": item.approvedQty || "",
      "單價": item.price || "",
      "金額": item.amount || "",
      "備註": item.note || ""
    });
  }
  return enriched;
}

async function appendApprovalLog({ request, action, actor, note, step }) {
  await appendRow("簽核紀錄", APPROVAL_HEADERS, {
    "單號": request.id,
    "動作時間": new Date().toISOString(),
    "關卡": step || request.approvalStatus?.currentStep || "",
    "動作": action,
    "簽核人工號": actor.employeeId,
    "簽核人": actor.name || actor.employeeId,
    "簽核人信箱": actor.email || "",
    "說明": note || "",
    "通知信箱": request.employeeEmail || ""
  });
}

const sheetsDomain = {
  USER_HEADERS,
  REQUEST_HEADERS,
  ITEM_HEADERS,
  APPROVAL_HEADERS,
  AuthError,
  publicUser,
  getUsers,
  getUser,
  saveUser,
  getRequests,
  getRequest,
  roleName,
  normalizeSystemRole,
  normalizeApprovalRole,
  normalizeUserRoles,
  isRole,
  canReadRequest,
  canEditRequest,
  canApprove,
  getSessionUser,
  persistRequest,
  appendApprovalLog
};

module.exports = process.env.DATABASE_URL
  ? require("./domain-postgres")
  : sheetsDomain;
