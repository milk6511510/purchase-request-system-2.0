const { json, readBody, requireSameOrigin, publicErrorMessage } = require("./_lib/http");
const {
  getSessionUser,
  getRequest,
  canEditRequest,
  persistRequest,
  appendApprovalLog,
  isRole
} = require("./_lib/domain");
const { sendMail, escapeHtml } = require("./integrations");
const { parseDataUrl } = require("./_lib/sheets");
const crypto = require("node:crypto");

const MAX_PHOTOS = 5;
const MAX_PHOTO_DATA_URL_LENGTH = 600000;
const SIGNATURE_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i;
const INLINE_SIGNATURE_MAX_LENGTH = 700000;
const FIELD_LIMITS = {
  requestType: 40,
  departmentCode: 32,
  applicantName: 120,
  applyDate: 10,
  needDate: 10,
  acceptanceDate: 10,
  receivedDate: 10,
  taxType: 40,
  purchaseMethod: 60,
  vendorName: 200,
  vendorTaxId: 32,
  contactPerson: 120,
  vendorAddress: 400,
  phone: 80,
  mobile: 80,
  fax: 80,
  paymentType: 120,
  deliveryDate: 10,
  deliveryBatch: 100,
  buyingMode: 60,
  purpose: 2000,
  acceptanceNote: 2000
};

function hasOnlyAllowedImageData(value, maxLength) {
  const dataUrl = String(value || "");
  return dataUrl.length <= maxLength && SIGNATURE_DATA_URL.test(dataUrl) && Boolean(parseDataUrl(dataUrl));
}

function validatePayload(payload) {
  const missing = [];
  if (!hasOnlyAllowedImageData(payload.applicantSignature, INLINE_SIGNATURE_MAX_LENGTH)) {
    missing.push("有效的申請人簽名");
  }
  if (!Array.isArray(payload.items) || payload.items.length > 100
    || !payload.items.some((item) => item && typeof item === "object" && String(item.name || "").trim())) {
    missing.push("至少一項品名");
  }
  if (payload.photos !== undefined && (!Array.isArray(payload.photos) || payload.photos.length > MAX_PHOTOS)) {
    missing.push(`照片附件（最多 ${MAX_PHOTOS} 張）`);
  } else if ((payload.photos || []).some((photo) => !photo || typeof photo !== "object" || Array.isArray(photo)
    || String(photo.name || "").length > 180
    || (photo.dataUrl && !hasOnlyAllowedImageData(photo.dataUrl, MAX_PHOTO_DATA_URL_LENGTH)))) {
    missing.push("有效的照片附件");
  }
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (payload[field] !== undefined && (typeof payload[field] !== "string" || payload[field].length > limit)) {
      missing.push("欄位內容長度或格式不正確");
      break;
    }
  }
  if (["categories", "attachments"].some((field) => payload[field] !== undefined
    && (!Array.isArray(payload[field]) || payload[field].length > 30
      || payload[field].some((value) => typeof value !== "string" || value.length > 80)))) {
    missing.push("選項資料格式不正確");
  }
  if (Array.isArray(payload.items)) {
    for (const item of payload.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        missing.push("品項資料格式不正確");
        break;
      }
      if (Object.entries({ name: 200, spec: 240, code: 80, unit: 40, amount: 32 })
        .some(([field, limit]) => item[field] !== undefined && String(item[field]).length > limit)) {
        missing.push("品項內容過長");
        break;
      }
    }
  }
  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    if (!item || typeof item !== "object") continue;
    const qty = item.qty === "" || item.qty === undefined ? 0 : Number(item.qty);
    const price = item.price === "" || item.price === undefined ? 0 : Number(item.price);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty < 0 || price < 0 || qty > 1000000 || price > 1000000000) {
      missing.push("有效的品項數量與單價");
      break;
    }
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

    if (!requireSameOrigin(req, res)) return;

    const user = await getSessionUser(req);
    const payload = await readBody(req);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      json(res, 400, { ok: false, error: "請購單資料格式無效" });
      return;
    }
    if (payload.id !== undefined && (typeof payload.id !== "string" || payload.id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(payload.id))) {
      json(res, 400, { ok: false, error: "請購單號格式無效" });
      return;
    }
    const existing = payload.id ? await getRequest(payload.id) : null;
    if (existing && !canEditRequest(user, existing)) {
      json(res, 403, { ok: false, error: "此請購單已超過 24 小時或非本人資料，請聯繫 IT" });
      return;
    }
    const missing = validatePayload(payload);
    if (missing.length) {
      json(res, 400, { ok: false, error: `請補齊必要資料：${missing.join("、")}` });
      return;
    }

    const isPrivileged = isRole(user, "superAdmin");
    const accountDepartment = String(user.departmentCode || "").trim().toUpperCase();
    const submittedDepartment = String(payload.departmentCode || "").trim().toUpperCase();
    if (!submittedDepartment || (!isPrivileged && (!accountDepartment || submittedDepartment !== accountDepartment))) {
      json(res, 403, { ok: false, error: "請購部門須由管理員指派，請確認帳號部門設定" });
      return;
    }

    const now = new Date().toISOString();
    const items = payload.items
      .filter((item) => item && typeof item === "object" && Object.values(item).some((value) => String(value || "").trim()))
      .map((item) => {
        const qty = item.qty === "" || item.qty === undefined ? 0 : Number(item.qty);
        const price = item.price === "" || item.price === undefined ? 0 : Number(item.price);
        return {
          name: String(item.name || "").trim(),
          spec: String(item.spec || "").trim(),
          code: String(item.code || "").trim(),
          unit: String(item.unit || "").trim(),
          qty: item.qty ?? "",
          approvedQty: "",
          price: item.price ?? "",
          amount: Math.round(qty * price * 100) / 100
        };
      });
    if (items.some((item) => !item.name)) {
      json(res, 400, { ok: false, error: "每筆已填寫的品項都必須提供品名" });
      return;
    }

    const existingPhotos = new Map((existing?.photos || []).map((photo) => [String(photo.id || ""), photo]));
    const photos = [];
    for (const photo of payload.photos || []) {
      const savedPhoto = existingPhotos.get(String(photo.id || ""));
      if (savedPhoto) {
        photos.push(savedPhoto);
        continue;
      }
      if (photo.dataUrl) {
        const match = String(photo.dataUrl).match(/^data:(image\/(?:png|jpeg|webp));base64,/i);
        photos.push({
          id: crypto.randomUUID(),
          name: String(photo.name || "附件照片").trim(),
          type: match[1].toLowerCase(),
          dataUrl: photo.dataUrl,
          addedAt: now
        });
        continue;
      }
      json(res, 400, { ok: false, error: "照片附件資料無效，請重新選取照片" });
      return;
    }
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isFinite(totalAmount) || totalAmount > 999999999999.99) {
      json(res, 400, { ok: false, error: "請購總金額超出允許範圍" });
      return;
    }

    const previousRoute = Array.isArray(existing?.approvalStatus?.route) ? existing.approvalStatus.route : [];
    const resetRoute = previousRoute.length
      ? previousRoute.map((step) => {
        if (step.step === "applicant") {
          return { ...step, actor: user.name || user.employeeId, actorEmployeeId: user.employeeId, status: "signed", signedAt: now };
        }
        if (step.step === "unitManager") return { ...step, status: "pending", signedAt: "" };
        if (step.step === "generalManager") return { ...step, status: "waiting", signedAt: "" };
        return step;
      })
      : [
        { step: "applicant", label: "申請人", actor: user.name || user.employeeId, actorEmployeeId: user.employeeId, status: "signed", signedAt: now },
        { step: "unitManager", label: "單位主管", actor: "依部門代號分派主管", status: "pending", signedAt: "" },
        { step: "generalManager", label: "總經理", actor: "總經理權限", status: "waiting", signedAt: "" }
      ];
    const savedPayload = {
      ...Object.fromEntries(Object.entries(FIELD_LIMITS).map(([field]) => [field, payload[field] || ""])),
      id: existing?.id || `REQ-${Date.now()}-${crypto.randomBytes(12).toString("hex").toUpperCase()}`,
      employeeId: existing?.employeeId || user.employeeId,
      employeeEmail: user.email || "",
      applicantName: user.name || user.employeeId,
      departmentCode: existing?.departmentCode || submittedDepartment,
      photos,
      categories: payload.categories || [],
      attachments: payload.attachments || [],
      applyDate: payload.applyDate || new Date().toISOString().slice(0, 10),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      items,
      totalAmount,
      approvalStatus: {
        currentStep: "unitManager",
        label: "待單位主管簽核",
        route: resetRoute
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
        <p><strong>請購單號：</strong>${escapeHtml(persisted.id)}</p>
        <p><strong>狀態：</strong>${escapeHtml(persisted.approvalStatus?.label || "待單位主管簽核")}</p>
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
    json(res, error.statusCode || 500, { ok: false, error: publicErrorMessage(error, "請購單儲存失敗，請稍後再試") });
  }
};
