const { getCookies } = require("./http");
const { readSession, SESSION_COOKIE } = require("./security");
const { query, withTransaction } = require("./db");
const { uploadDataUrl } = require("./sheets");

class AuthError extends Error {
  constructor(message = "未登入或登入已過期") {
    super(message);
    this.name = "AuthError";
    this.statusCode = 401;
  }
}

function iso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeSystemRole(value) {
  const role = String(value || "").trim();
  if (["superAdmin", "admin", "最高權限", "最高權限管理者", "最高權限者"].includes(role)) return "superAdmin";
  if (["manager", "管理者"].includes(role)) return "manager";
  if (["generalManager", "總經理"].includes(role)) return "manager";
  return "user";
}

function normalizeApprovalRole(value, fallbackRole = "") {
  const role = String(value || "").trim();
  if (["unitManager", "單位主管"].includes(role)) return "unitManager";
  if (["generalManager", "總經理"].includes(role)) return "generalManager";
  const fallback = String(fallbackRole || "").trim();
  if (["unitManager", "單位主管"].includes(fallback)) return "unitManager";
  if (["generalManager", "總經理"].includes(fallback)) return "generalManager";
  return "";
}

function normalizeUserRoles(user = {}) {
  return {
    role: normalizeSystemRole(user.role),
    approvalRole: normalizeApprovalRole(user.approvalRole, user.role)
  };
}

function userFromRow(row) {
  if (!row) return null;
  const roles = normalizeUserRoles({ role: row.role, approvalRole: row.approval_role });
  return {
    employeeId: row.employee_id,
    name: row.name,
    email: row.email,
    departmentCode: row.department_code,
    ...roles,
    active: row.active,
    mustChangePassword: row.must_change_password === true,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    note: row.note,
    passwordHash: row.password_hash
  };
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

async function getUsers() {
  const result = await query("SELECT * FROM purchase_request.users ORDER BY employee_id");
  return result.rows.map(userFromRow);
}

async function getUser(employeeId) {
  const result = await query(
    "SELECT * FROM purchase_request.users WHERE UPPER(employee_id) = UPPER($1) LIMIT 1",
    [String(employeeId || "").trim()]
  );
  return userFromRow(result.rows[0]);
}

async function saveUser(user) {
  const employeeId = String(user.employeeId || "").trim().toUpperCase();
  if (!employeeId) throw new Error("員工編號不可空白");
  const roles = normalizeUserRoles(user);
  await query(
    `INSERT INTO purchase_request.users
      (employee_id, name, email, department_code, role, approval_role, active, must_change_password, password_hash, note, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), NOW())
     ON CONFLICT (employee_id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      department_code = EXCLUDED.department_code,
      role = EXCLUDED.role,
      approval_role = EXCLUDED.approval_role,
      active = EXCLUDED.active,
      must_change_password = EXCLUDED.must_change_password,
      password_hash = EXCLUDED.password_hash,
      note = EXCLUDED.note,
      updated_at = NOW()`,
    [
      employeeId,
      String(user.name || "").trim(),
      String(user.email || "").trim().toLowerCase(),
      String(user.departmentCode || "").trim().toUpperCase(),
      roles.role,
      roles.approvalRole,
      user.active !== false,
      user.mustChangePassword === true,
      user.passwordHash || "",
      user.note || "",
      iso(user.createdAt) || null
    ]
  );
  return getUser(employeeId);
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

async function storeFiles(payload) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
  const photos = [];
  for (const photo of payload.photos || []) {
    if (!photo.dataUrl) {
      const { dataUrl, ...metadata } = photo;
      photos.push(metadata);
      continue;
    }
    if (!folderId) {
      throw new Error("附件尚未設定公司雲端儲存位置，請聯繫 IT 後再送出，避免照片或簽名遺失");
    }
    const file = await uploadDataUrl({
      dataUrl: photo.dataUrl,
      fileName: `${payload.id}-${photo.name || "photo.jpg"}`,
      folderId
    });
    if (!file?.id) throw new Error("照片上傳失敗，請稍後再試");
    const { dataUrl, ...metadata } = photo;
    photos.push({
      ...metadata,
      dataUrl: "",
      fileId: file.id,
      fileUrl: file.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
      storageProvider: "google_drive"
    });
  }

  let applicantSignature = payload.applicantSignature || "";
  let signatureFile = null;
  let signatureData = null;
  let signatureMimeType = "";
  if (String(applicantSignature).startsWith("data:")) {
    if (folderId) {
      signatureFile = await uploadDataUrl({
        dataUrl: applicantSignature,
        fileName: `${payload.id}-applicant-signature.png`,
        folderId
      });
      if (!signatureFile?.id) throw new Error("簽名上傳失敗，請稍後再試");
      applicantSignature = signatureFile.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(signatureFile.id)}`;
    } else {
      const match = String(applicantSignature).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i);
      if (!match) throw new Error("簽名圖片格式不正確，請重新簽名");
      signatureData = Buffer.from(match[2], "base64");
      signatureMimeType = match[1].toLowerCase();
      if (!signatureData.length || signatureData.length > 512 * 1024) {
        throw new Error("簽名檔案超過 512 KB，請重新簽名後再送出");
      }
    }
  }
  return {
    ...payload,
    photos,
    applicantSignature,
    signatureFileId: signatureFile?.id || payload.signatureFileId || "",
    signatureData,
    signatureMimeType
  };
}

function cleanPayload(payload) {
  const { signatureData, signatureMimeType, ...safePayload } = payload;
  return {
    ...safePayload,
    photos: (payload.photos || []).map(({ dataUrl, ...photo }) => photo),
    applicantSignature: String(payload.applicantSignature || "").startsWith("data:")
      ? "已簽名"
      : payload.applicantSignature || ""
  };
}

function attachmentRows(request) {
  const attachments = (request.photos || []).map((photo) => ({
    id: String(photo.id || `${request.id}-photo-${Math.random().toString(36).slice(2)}`),
    kind: "photo",
    provider: photo.storageProvider || (photo.fileId ? "google_drive" : ""),
    fileId: photo.fileId || "",
    storageKey: photo.storageKey || "",
    name: photo.name || "",
    mimeType: photo.type || "",
    url: photo.fileUrl || "",
    metadata: { addedAt: photo.addedAt || "" }
  }));
  if (request.signatureFileId || request.signatureData || (request.applicantSignature && request.applicantSignature !== "已簽名")) {
    attachments.push({
      id: `signature-${request.id}`,
      kind: "signature",
      provider: request.signatureFileId ? "google_drive" : request.signatureData ? "neon_postgres" : "",
      fileId: request.signatureFileId || "",
      storageKey: "",
      name: `${request.id}-applicant-signature.png`,
      mimeType: request.signatureMimeType || "image/png",
      url: request.applicantSignature === "已簽名" ? "" : request.applicantSignature,
      fileData: request.signatureData || null,
      metadata: {}
    });
  }
  return attachments;
}

async function persistRequest(payload) {
  const request = await storeFiles(payload);
  const safePayload = cleanPayload(request);
  const status = request.approvalStatus || {};
  const createdAt = iso(request.createdAt) || new Date().toISOString();
  const updatedAt = iso(request.updatedAt) || new Date().toISOString();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO purchase_request.requests
        (id, employee_id, employee_email, applicant_name, department_code, request_type, apply_date, need_date,
         vendor_name, vendor_tax_id, tax_type, total_amount, status_label, current_step, source_system,
         external_ref, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19)
       ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        employee_email = EXCLUDED.employee_email,
        applicant_name = EXCLUDED.applicant_name,
        department_code = EXCLUDED.department_code,
        request_type = EXCLUDED.request_type,
        apply_date = EXCLUDED.apply_date,
        need_date = EXCLUDED.need_date,
        vendor_name = EXCLUDED.vendor_name,
        vendor_tax_id = EXCLUDED.vendor_tax_id,
        tax_type = EXCLUDED.tax_type,
        total_amount = EXCLUDED.total_amount,
        status_label = EXCLUDED.status_label,
        current_step = EXCLUDED.current_step,
        source_system = EXCLUDED.source_system,
        external_ref = EXCLUDED.external_ref,
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at`,
      [
        request.id,
        request.employeeId || "",
        request.employeeEmail || "",
        request.applicantName || "",
        request.departmentCode || "",
        request.requestType || "",
        request.applyDate || "",
        request.needDate || "",
        request.vendorName || "",
        request.vendorTaxId || "",
        request.taxType || "",
        Number(request.totalAmount) || 0,
        status.label || "",
        status.currentStep || "",
        request.sourceSystem || "web",
        request.externalRef || null,
        JSON.stringify(safePayload),
        createdAt,
        updatedAt
      ]
    );

    await client.query("DELETE FROM purchase_request.request_items WHERE request_id = $1", [request.id]);
    for (const [index, item] of (request.items || []).entries()) {
      await client.query(
        "INSERT INTO purchase_request.request_items (request_id, item_index, payload) VALUES ($1, $2, $3::jsonb)",
        [request.id, index + 1, JSON.stringify(item)]
      );
    }

    await client.query("DELETE FROM purchase_request.attachments WHERE request_id = $1", [request.id]);
    for (const attachment of attachmentRows(request)) {
      await client.query(
        `INSERT INTO purchase_request.attachments
          (request_id, attachment_id, kind, provider, file_id, storage_key, file_name, mime_type, file_url, file_data, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [request.id, attachment.id, attachment.kind, attachment.provider, attachment.fileId,
          attachment.storageKey, attachment.name, attachment.mimeType, attachment.url, attachment.fileData,
          JSON.stringify(attachment.metadata)]
      );
    }
  });
  const saved = { ...request };
  delete saved.signatureData;
  delete saved.signatureMimeType;
  if (request.signatureData) {
    saved.applicantSignature = `data:${request.signatureMimeType};base64,${request.signatureData.toString("base64")}`;
  }
  return saved;
}

function jsonValue(value, fallback) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function groupByRequest(rows) {
  return rows.reduce((map, row) => {
    const list = map.get(row.request_id) || [];
    list.push(row);
    map.set(row.request_id, list);
    return map;
  }, new Map());
}

async function getRequests() {
  const result = await query("SELECT * FROM purchase_request.requests ORDER BY updated_at DESC, created_at DESC");
  const ids = result.rows.map((row) => row.id);
  if (!ids.length) return [];
  const [itemsResult, attachmentsResult, logsResult] = await Promise.all([
    query("SELECT request_id, payload FROM purchase_request.request_items WHERE request_id = ANY($1::text[]) ORDER BY item_index", [ids]),
    query("SELECT * FROM purchase_request.attachments WHERE request_id = ANY($1::text[]) ORDER BY created_at", [ids]),
    query("SELECT * FROM purchase_request.approval_logs WHERE request_id = ANY($1::text[]) ORDER BY action_at", [ids])
  ]);
  const itemsByRequest = groupByRequest(itemsResult.rows);
  const attachmentsByRequest = groupByRequest(attachmentsResult.rows);
  const logsByRequest = groupByRequest(logsResult.rows);

  return result.rows.map((row) => {
    const payload = jsonValue(row.payload, {});
    const attachments = attachmentsByRequest.get(row.id) || [];
    const photoRows = attachments.filter((attachment) => attachment.kind === "photo");
    const signature = attachments.find((attachment) => attachment.kind === "signature");
    const photos = photoRows.length ? photoRows.map((attachment) => ({
      id: attachment.attachment_id,
      name: attachment.file_name,
      type: attachment.mime_type,
      fileId: attachment.file_id,
      fileUrl: attachment.file_url,
      storageKey: attachment.storage_key,
      storageProvider: attachment.provider,
      ...jsonValue(attachment.metadata, {})
    })) : payload.photos || [];
    const status = jsonValue(payload.approvalStatus, {});
    return {
      ...payload,
      id: row.id,
      employeeId: row.employee_id,
      employeeEmail: row.employee_email,
      applicantName: row.applicant_name,
      departmentCode: row.department_code,
      requestType: row.request_type,
      applyDate: row.apply_date,
      needDate: row.need_date,
      vendorName: row.vendor_name,
      vendorTaxId: row.vendor_tax_id,
      taxType: row.tax_type,
      totalAmount: Number(row.total_amount),
      sourceSystem: row.source_system,
      externalRef: row.external_ref,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      items: (itemsByRequest.get(row.id) || []).map((item) => jsonValue(item.payload, {})),
      photos,
      applicantSignature: signature?.file_data
        ? `data:${signature.mime_type || "image/png"};base64,${signature.file_data.toString("base64")}`
        : signature?.file_url || payload.applicantSignature || "",
      signatureFileId: signature?.file_id || payload.signatureFileId || "",
      approvalStatus: {
        ...status,
        label: row.status_label || status.label || "",
        currentStep: row.current_step || status.currentStep || ""
      },
      approvalLogs: (logsByRequest.get(row.id) || []).map((log) => ({
        actionAt: iso(log.action_at),
        step: log.step,
        action: log.action,
        actorEmployeeId: log.actor_employee_id,
        actorName: log.actor_name,
        actorEmail: log.actor_email,
        note: log.note,
        notificationEmail: log.notification_email
      }))
    };
  });
}

async function getRequest(id) {
  const requests = await getRequests();
  return requests.find((request) => request.id === id) || null;
}

async function appendApprovalLog({ request, action, actor, note, step }) {
  await query(
    `INSERT INTO purchase_request.approval_logs
      (request_id, step, action, actor_employee_id, actor_name, actor_email, note, notification_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [request.id, step || request.approvalStatus?.currentStep || "", action,
      actor.employeeId || "", actor.name || actor.employeeId || "", actor.email || "",
      note || "", request.employeeEmail || ""]
  );
}

module.exports = {
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
