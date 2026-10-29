const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { isFullyApproved, renderDocument } = require("../assets/triplicate-template");

function approvedRecord(overrides = {}) {
  return {
    id: "REQ-2026-0001",
    employeeId: "E001",
    applicantName: "王小明",
    requestType: "一般",
    departmentCode: "ADM01",
    applyDate: "2026-10-29",
    needDate: "2026-11-05",
    taxType: "含稅",
    categories: ["事務性器具"],
    items: [{ name: "筆電", spec: "14 吋", code: "IT-001", unit: "台", qty: 1, approvedQty: 1, price: 30000, amount: 30000 }],
    totalAmount: 30000,
    purchaseMethod: "行政管理部單位",
    vendorName: "範例廠商",
    paymentType: "按公司規定",
    deliveryBatch: "一次交貨",
    buyingMode: "訂購",
    purpose: "部門設備更新",
    attachments: ["規格保固"],
    applicantSignature: "data:image/png;base64,YWJj",
    approvalStatus: {
      label: "已核准",
      currentStep: "closed",
      route: [
        { step: "applicant", actor: "王小明", status: "signed", signedAt: "2026-10-29T01:00:00.000Z" },
        { step: "unitManager", actor: "李主管 (M001)", status: "approved", signedAt: "2026-10-29T02:00:00.000Z" },
        { step: "generalManager", actor: "陳總經理 (G001)", status: "approved", signedAt: "2026-10-29T03:00:00.000Z" }
      ]
    },
    ...overrides
  };
}

test("only fully approved requests can generate the triplicate form", () => {
  assert.equal(isFullyApproved(approvedRecord()), true);
  assert.equal(isFullyApproved(approvedRecord({
    approvalStatus: { label: "已退回", currentStep: "closed", route: [] }
  })), false);
  assert.equal(isFullyApproved(approvedRecord({
    approvalStatus: { label: "已核准", currentStep: "closed", route: [{ step: "unitManager", status: "approved", signedAt: "2026-10-29" }] }
  })), false);
});

test("browser script exposes the template API on window", () => {
  const source = fs.readFileSync(path.join(__dirname, "../assets/triplicate-template.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox);

  assert.equal(typeof sandbox.window.AiwaTriplicateTemplate.renderDocument, "function");
  assert.equal(sandbox.window.AiwaTriplicateTemplate.isFullyApproved(approvedRecord()), true);
});

test("triplicate output includes three destinations, approval metadata, and escaped field text", () => {
  const html = renderDocument(approvedRecord({ purpose: "<script>alert(1)</script>" }), {
    logoUrl: "https://example.com/assets/aiwa-logo.svg",
    printedAt: "2026-10-29T03:00:00.000Z"
  });

  assert.equal((html.match(/class="copy-tag"/g) || []).length, 3);
  assert.match(html, /第一聯/);
  assert.match(html, /第二聯/);
  assert.match(html, /第三聯/);
  assert.match(html, /李主管 \(M001\)/);
  assert.match(html, /陳總經理 \(G001\)/);
  assert.match(html, /data:image\/png;base64,YWJj/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("long item lists add labeled continuation pages for every copy", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ name: `品項${index + 1}`, qty: 1 }));
  const html = renderDocument(approvedRecord({ items }));

  assert.equal((html.match(/class="page continuation-page"/g) || []).length, 3);
  for (let index = 1; index <= 8; index += 1) assert.match(html, new RegExp(`品項${index}`));
});
