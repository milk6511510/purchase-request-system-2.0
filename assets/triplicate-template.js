(function attachTriplicateTemplate(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AiwaTriplicateTemplate = api;
})(typeof window === "undefined" ? globalThis : window, function createTriplicateTemplate() {
  const copies = [
    { label: "第一聯", recipient: "採購單位", color: "#b90025" },
    { label: "第二聯", recipient: "行政管理部", color: "#986000" },
    { label: "第三聯", recipient: "財務單位", color: "#176b55" }
  ];
  const mainPageItemLimit = 5;
  const continuationItemLimit = 15;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function isFullyApproved(record) {
    const status = record?.approvalStatus || {};
    const route = Array.isArray(status.route) ? status.route : [];
    return status.currentStep === "closed"
      && status.label === "已核准"
      && ["unitManager", "generalManager"].every((step) => route.some((entry) => (
        entry.step === step && entry.status === "approved" && entry.signedAt
      )));
  }

  function dateText(value) {
    const text = String(value || "").trim();
    return text ? escapeHtml(text.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$1/$2/$3")) : "";
  }

  function dateTimeText(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(date.toLocaleString("zh-TW", { hour12: false }));
  }

  function valueText(value) {
    return String(value ?? "").trim() ? escapeHtml(value) : "&nbsp;";
  }

  function field(label, value, className = "") {
    return `<div class="field ${className}"><span class="field-label">${escapeHtml(label)}</span><strong class="field-value">${valueText(value)}</strong></div>`;
  }

  function displayNumber(value) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    return Number.isFinite(number) ? escapeHtml(number.toLocaleString("zh-TW", { maximumFractionDigits: 2 })) : escapeHtml(value);
  }

  function checkedList(values, options) {
    const selected = new Set(Array.isArray(values) ? values : []);
    return options.map((option) => `<span class="check"><b>${selected.has(option) ? "&#9745;" : "&#9633;"}</b>${escapeHtml(option)}</span>`).join("");
  }

  function signatureImage(value) {
    const signature = String(value || "");
    return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(signature)
      ? `<img class="signature-image" src="${signature}" alt="申請人手寫簽名">`
      : "<span class=\"signature-text\">已完成手寫簽名</span>";
  }

  function approvalBox(title, actor, dateTime, signature = "") {
    return `<div class="approval-box">
      <strong>${escapeHtml(title)}</strong>
      <div class="approval-mark">${signature || "電子簽核完成"}</div>
      <span>${valueText(actor)}</span>
      <small>${dateTime ? `核准時間：${dateTimeText(dateTime)}` : "核准時間："}</small>
    </div>`;
  }

  function itemsTable(items, start, end, minRows = 0) {
    const pageItems = items.slice(start, end);
    while (pageItems.length < minRows) pageItems.push(null);
    const rows = pageItems.map((item) => `<tr>
      <td>${valueText(item?.name)}</td><td>${valueText(item?.spec)}</td><td>${valueText(item?.code)}</td>
      <td>${valueText(item?.unit)}</td><td class="number">${displayNumber(item?.qty)}</td>
      <td class="number">${displayNumber(item?.approvedQty)}</td><td class="number">${displayNumber(item?.price)}</td>
      <td class="number">${displayNumber(item?.amount)}</td>
    </tr>`).join("");
    return `<table class="items-table">
      <colgroup><col style="width:20%"><col style="width:14%"><col style="width:14%"><col style="width:8%"><col style="width:10%"><col style="width:10%"><col style="width:11%"><col style="width:13%"></colgroup>
      <thead><tr><th>材料 / 物品名稱</th><th>規格</th><th>物品編號</th><th>單位</th><th>申購數量</th><th>核准數量</th><th>單價</th><th>金額</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function header(record, copy, options, pageLabel = "") {
    const logo = options.logoUrl ? `<img class="logo" src="${escapeHtml(options.logoUrl)}" alt="AIWA">` : "";
    return `<header class="document-header">
      <div class="brand">${logo}<div><strong>愛華國際股份有限公司</strong><span>請購單</span></div></div>
      <div class="header-detail"><div class="copy-tag" style="--copy-color:${copy.color}"><b>${copy.label}</b><span>${copy.recipient}</span></div><div class="request-number"><span>請購單號</span><strong>${valueText(record.id)}</strong>${pageLabel ? `<small>${escapeHtml(pageLabel)}</small>` : ""}</div></div>
    </header>`;
  }

  function renderMainPage(record, copy, options, items) {
    const route = Array.isArray(record.approvalStatus?.route) ? record.approvalStatus.route : [];
    const applicant = route.find((entry) => entry.step === "applicant") || {};
    const manager = route.find((entry) => entry.step === "unitManager") || {};
    const generalManager = route.find((entry) => entry.step === "generalManager") || {};
    const attachmentNames = Array.isArray(record.attachments) ? record.attachments : [];
    const photoCount = Array.isArray(record.photos) ? record.photos.length : 0;
    const total = Number(record.totalAmount) || 0;
    const rows = itemsTable(items, 0, mainPageItemLimit, mainPageItemLimit);

    return `<section class="page main-page">
      ${header(record, copy, options)}
      <div class="meta-grid">
        ${field("申請類型", record.requestType)}${field("部門代號", record.departmentCode)}
        ${field("申請人", record.applicantName)}${field("員工編號", record.employeeId)}
        ${field("申請日期", dateText(record.applyDate))}${field("須用日期", dateText(record.needDate))}
        ${field("驗收日期", dateText(record.acceptanceDate))}${field("收貨日期", dateText(record.receivedDate))}
      </div>
      <section class="section category-section">
        <div class="section-title">稅別與請購類別</div>
        <div class="category-row"><b>稅別：${escapeHtml(record.taxType || "未填")}</b><div class="checks">${checkedList(record.categories, ["維修器材", "事務性器具", "消耗性", "材料類", "雜項購置", "房屋附屬設施", "費用", "固定資產", "修繕工程", "研發器材"])}</div></div>
      </section>
      <section class="section">
        <div class="section-title">材料 / 物品明細</div>
        ${rows}
        <div class="total-row"><span>合計金額</span><strong>NT$ ${escapeHtml(total.toLocaleString("zh-TW", { maximumFractionDigits: 2 }))}</strong></div>
      </section>
      <section class="section">
        <div class="section-title">採購與資產資料（由相關單位填寫）</div>
        <div class="inline-fields">
          ${field("採購編號", "")}${field("財務部財產編號", "")}${field("行政管理部資產編號", "")}
        </div>
      </section>
      <div class="dual-sections">
        <section class="section">
          <div class="section-title">上次訂購情形</div>
          <div class="small-grid">${field("廠商", "")}${field("廠牌", "")}${field("日期", "")}${field("單價 / 數量", "")}</div>
        </section>
        <section class="section">
          <div class="section-title">詢價紀錄（由採購單位填寫）</div>
          <table class="quote-table"><thead><tr><th></th><th>廠商一</th><th>廠商二</th><th>廠商三</th></tr></thead><tbody>
            <tr><th>廠牌 / 單價</th><td></td><td></td><td></td></tr><tr><th>議後價</th><td></td><td></td><td></td></tr>
          </tbody></table>
        </section>
      </div>
      <section class="section">
        <div class="section-title">採購方式與廠商資料</div>
        <div class="vendor-grid">
          ${field("採購方式", record.purchaseMethod)}${field("公司名稱 / 廠商", record.vendorName)}${field("統一編號", record.vendorTaxId)}${field("聯絡人", record.contactPerson)}
          ${field("地址", record.vendorAddress, "span-2")}${field("電話 / 行動", [record.phone, record.mobile].filter(Boolean).join(" / "))}${field("傳真", record.fax)}
        </div>
      </section>
      <section class="section">
        <div class="section-title">供需情形、交貨付款與用途說明</div>
        <div class="inline-fields supply-row">${field("庫存量", "")}${field("未到量", "")}${field("月用量", "")}${field("預定交貨日", dateText(record.deliveryDate))}</div>
        <div class="inline-fields">${field("付款方式", record.paymentType)}${field("交貨方式", record.deliveryBatch)}${field("採購型態", record.buyingMode)}${field("驗收日期", dateText(record.acceptanceDate))}</div>
        <div class="note-grid"><div><span class="field-label">用途說明</span><p>${valueText(record.purpose)}</p></div><div><span class="field-label">驗收 / 其他說明</span><p>${valueText(record.acceptanceNote)}</p></div></div>
      </section>
      <section class="section attachment-section">
        <div class="section-title">檢附資料</div>
        <div class="attachment-list">${checkedList(attachmentNames, ["證照影本", "規格保固", "報關資料"])}<span>照片附件：${photoCount} 件（電子檔請於系統查閱）</span></div>
      </section>
      <section class="section approval-section">
        <div class="section-title">簽核紀錄</div>
        <div class="approval-grid">
          ${approvalBox("申請人｜手寫簽名", applicant.actor || record.applicantName || record.employeeId, applicant.signedAt, signatureImage(record.applicantSignature))}
          ${approvalBox("單位主管｜電子簽核", manager.actor, manager.signedAt)}
          ${approvalBox("總經理｜電子簽核", generalManager.actor, generalManager.signedAt)}
        </div>
      </section>
      <footer class="document-footer"><span>本聯單依系統請購資料及簽核紀錄產生；附件影像不包含於本 PDF。</span><span>列印時間：${dateTimeText(options.printedAt)}</span></footer>
    </section>`;
  }

  function renderContinuationPage(record, copy, options, items, pageNumber) {
    return `<section class="page continuation-page">
      ${header(record, copy, options, `明細續頁 ${pageNumber}`)}
      <div class="continuation-note">請購單號：${valueText(record.id)}　申請人：${valueText(record.applicantName)}　部門：${valueText(record.departmentCode)}</div>
      <section class="section continuation-items"><div class="section-title">材料 / 物品明細續頁</div>${itemsTable(items, 0, items.length)}</section>
      <footer class="document-footer"><span>本頁為請購明細續頁，請與對應聯別之主表一併保存。</span><span>${copy.label}｜${copy.recipient}</span></footer>
    </section>`;
  }

  function renderDocument(record, options = {}) {
    const requestItems = Array.isArray(record.items) ? record.items : [];
    const pages = [];
    copies.forEach((copy) => {
      pages.push(renderMainPage(record, copy, options, requestItems));
      for (let offset = mainPageItemLimit; offset < requestItems.length; offset += continuationItemLimit) {
        const pageNumber = Math.floor((offset - mainPageItemLimit) / continuationItemLimit) + 2;
        pages.push(renderContinuationPage(record, copy, options, requestItems.slice(offset, offset + continuationItemLimit), pageNumber));
      }
    });

    return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIWA 請購三聯單 ${escapeHtml(record.id)}</title>
      <style>
        @page{size:A4 portrait;margin:6mm}
        *{box-sizing:border-box}
        body{margin:0;background:#eee;color:#202127;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif;font-size:7.5pt;line-height:1.2}
        .page{position:relative;width:100%;min-height:285mm;margin:0 auto 8mm;padding:0;display:flex;flex-direction:column;gap:1.5mm;background:#fff;break-after:page;page-break-after:always}
        .page:last-child{break-after:auto;page-break-after:auto}
        .document-header{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:1mm 0 2mm;border-bottom:1.2px solid #252525}
        .brand{display:flex;align-items:center;gap:3mm;min-width:0}.logo{width:26mm;max-height:10mm;object-fit:contain}
        .brand div{display:flex;flex-direction:column;gap:1mm}.brand strong{font-size:9pt}.brand span{font-size:15pt;font-weight:800}
        .header-detail{display:flex;align-items:center;gap:3mm}.copy-tag{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:26mm;padding:1.4mm 2mm;border:1.4px solid var(--copy-color);color:var(--copy-color);text-align:center}
        .copy-tag b{font-size:11pt}.copy-tag span{font-size:8pt;font-weight:700}.request-number{max-width:52mm;text-align:right}.request-number span,.request-number small{display:block;color:#555;font-size:7pt}.request-number strong{display:block;overflow-wrap:anywhere;font-size:8pt}
        .meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-left:1px solid #333;border-top:1px solid #333}
        .field{min-width:0;min-height:8mm;padding:1mm 1.4mm;border-right:1px solid #333;border-bottom:1px solid #333;display:flex;flex-direction:column;justify-content:center;gap:.6mm}
        .field-label{color:#333;font-size:6.6pt;font-weight:700}.field-value{min-height:3mm;overflow-wrap:anywhere;font-size:7.5pt;font-weight:500}
        .section{min-width:0;border:1px solid #333;break-inside:avoid;page-break-inside:avoid}.section-title{padding:1mm 1.5mm;border-bottom:1px solid #333;background:#f1f1f1;font-size:7.7pt;font-weight:800}
        .category-row{display:flex;align-items:center;gap:2mm;padding:1mm 1.5mm}.checks{display:flex;align-items:center;flex-wrap:wrap;gap:1.8mm}.check{white-space:nowrap;font-size:6.5pt}.check b{font-size:8pt;padding-right:.5mm}
        .items-table,.quote-table{width:100%;border-collapse:collapse;table-layout:fixed}.items-table th,.items-table td,.quote-table th,.quote-table td{border:1px solid #333;padding:.9mm 1mm;overflow-wrap:anywhere;vertical-align:middle}.items-table th,.quote-table th{background:#f5f5f5;text-align:center;font-size:6.4pt}.items-table td{height:6.6mm;font-size:7pt}.items-table .number{text-align:right;font-variant-numeric:tabular-nums}
        .total-row{display:flex;justify-content:flex-end;align-items:center;gap:4mm;padding:1mm 2mm;border-top:1px solid #333;font-size:8pt}.total-row strong{min-width:32mm;text-align:right;font-size:9pt}
        .inline-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-left:1px solid #333}.inline-fields .field{min-height:7mm}
        .dual-sections{display:grid;grid-template-columns:1fr 1.2fr;gap:1.5mm}.small-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-left:1px solid #333}.small-grid .field{min-height:7mm}
        .quote-table th,.quote-table td{height:5mm;font-size:6.5pt}.quote-table th:first-child{width:23%}
        .vendor-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-left:1px solid #333}.vendor-grid .field{min-height:7mm}.span-2{grid-column:span 2}
        .supply-row .field{min-height:6mm}.note-grid{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #333}.note-grid>div{min-width:0;min-height:12mm;padding:1mm 1.5mm}.note-grid>div+div{border-left:1px solid #333}.note-grid p{margin:1mm 0 0;min-height:7mm;white-space:pre-wrap;overflow-wrap:anywhere;font-size:7pt}
        .attachment-section .section-title{display:inline-block;border-right:1px solid #333}.attachment-list{display:flex;align-items:center;flex-wrap:wrap;gap:2mm;padding:1mm 1.5mm}.attachment-list>span{font-size:6.5pt}
        .approval-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.approval-box{min-width:0;min-height:26mm;padding:1.2mm 1.5mm;display:flex;flex-direction:column;gap:1mm}.approval-box+.approval-box{border-left:1px solid #333}.approval-box>strong{font-size:7.2pt}.approval-mark{flex:1;min-height:9mm;display:grid;place-items:center;border-bottom:1px solid #777;text-align:center;font-size:7pt;color:#555}.signature-image{display:block;max-width:100%;max-height:11mm;object-fit:contain}.signature-text{font-size:7pt;color:#555}.approval-box>span{font-size:6.8pt}.approval-box small{font-size:6pt;color:#444}
        .document-footer{margin-top:auto;display:flex;justify-content:space-between;gap:3mm;padding-top:1.2mm;border-top:1px solid #888;color:#444;font-size:6pt}
        .continuation-note{padding:2mm;border:1px solid #555;font-size:8pt}.continuation-items{margin-top:1mm}.continuation-items .items-table td{height:9mm}.continuation-page .document-footer{margin-top:auto}
        @media screen{.page{width:210mm;min-height:285mm;padding:0;background:#fff;box-shadow:0 2mm 8mm #999; padding-bottom:3mm}}
        @media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{margin:0;box-shadow:none} .section-title,.items-table th,.quote-table th{background:#eee!important}}
      </style></head><body>${pages.join("")}
      <script>window.addEventListener("load",function(){var images=Array.from(document.images);Promise.all(images.map(function(image){if(image.complete)return Promise.resolve();return new Promise(function(resolve){image.addEventListener("load",resolve,{once:true});image.addEventListener("error",resolve,{once:true});});})).then(function(){window.focus();setTimeout(function(){window.print();},180);});});<\/script>
    </body></html>`;
  }

  return { isFullyApproved, renderDocument };
});
