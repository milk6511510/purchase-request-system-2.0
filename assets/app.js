    const EDIT_LIMIT_HOURS = 24;
    let currentUser = null;
    let usersCache = [];
    let recordsCache = [];
    let uploadedPhotos = [];
    let applicantSignature = "";
    let signaturePadReady = false;
    let isSigning = false;

    const formFields = [
      "requestType", "departmentCode", "applicantName", "applyDate", "needDate",
      "acceptanceDate", "receivedDate", "taxType", "purchaseMethod", "vendorName",
      "vendorTaxId", "contactPerson", "vendorAddress", "phone", "mobile", "fax",
      "paymentType", "deliveryDate", "deliveryBatch", "buyingMode", "purpose",
      "acceptanceNote"
    ];

    const itemColumns = ["name", "spec", "code", "unit", "qty", "approvedQty", "price", "amount"];

    function todayString() {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    function getCurrentUser() {
      return currentUser;
    }

    function isSuperAdmin(user = currentUser) {
      return ["superAdmin", "admin", "最高權限", "最高權限者"].includes(user?.role);
    }

    function hasApprovalRole(user = currentUser) {
      return ["unitManager", "generalManager"].includes(user?.approvalRole)
        || ["unitManager", "generalManager", "單位主管", "總經理"].includes(user?.role);
    }

    function getUsers() {
      return usersCache;
    }

    function saveUsers(users) {
      usersCache = Array.isArray(users) ? users : [];
    }

    function findUser(employeeId) {
      return getUsers().find((user) => user.employeeId === employeeId);
    }

    function getRecords() {
      return recordsCache;
    }

    function saveRecords(records) {
      recordsCache = Array.isArray(records) ? records : [];
      refreshVendorSuggestions();
    }

    function refreshVendorSuggestions() {
      const datalist = document.getElementById("vendorSuggestions");
      if (!datalist) return;
      const vendors = window.AiwaVendorHistory.getPersonalVendors(getRecords(), currentUser?.employeeId);
      datalist.innerHTML = vendors.map((vendor) => {
        const details = [vendor.vendorTaxId && `統編 ${vendor.vendorTaxId}`, vendor.contactPerson].filter(Boolean).join(" · ");
        return `<option value="${escapeHtml(vendor.vendorName)}" label="${escapeHtml(details)}"></option>`;
      }).join("");
    }

    function applyPersonalVendor() {
      const vendors = window.AiwaVendorHistory.getPersonalVendors(getRecords(), currentUser?.employeeId);
      const vendor = window.AiwaVendorHistory.findPersonalVendor(vendors, document.getElementById("vendorName").value);
      if (!vendor) return;
      ["vendorTaxId", "contactPerson", "vendorAddress", "phone", "mobile", "fax"].forEach((field) => {
        document.getElementById(field).value = vendor[field] || "";
      });
    }

    function formatCurrency(value) {
      const number = Number(value) || 0;
      return `NT$ ${number.toLocaleString("zh-TW")}`;
    }

    function formatDateTime(value) {
      return new Date(value).toLocaleString("zh-TW", { hour12: false });
    }

    function canEdit(record) {
      const diffHours = (Date.now() - new Date(record.createdAt).getTime()) / 36e5;
      return record.employeeId === currentUser?.employeeId
        && Number.isFinite(diffHours) && diffHours >= 0 && diffHours <= EDIT_LIMIT_HOURS;
    }

    function showDialog(title, message) {
      document.getElementById("dialogTitle").textContent = title;
      document.getElementById("dialogMessage").textContent = message;
      document.getElementById("messageDialog").showModal();
    }

    function closeDialog() {
      document.getElementById("messageDialog").close();
    }

    document.getElementById("vendorName").addEventListener("change", applyPersonalVendor);

    document.getElementById("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await apiRequest("/api/auth", {
          method: "POST",
          body: JSON.stringify({
            employeeId: document.getElementById("employeeId").value.trim(),
            password: document.getElementById("password").value
          })
        });
        currentUser = result.user;
        if (currentUser.mustChangePassword) {
          await bootApp();
          return;
        }
        await loadBackendState();
        await bootApp();
      } catch (error) {
        showDialog("登入失敗", error.message || "無法登入，請確認後端環境設定。");
      }
    });

    document.getElementById("passwordChangeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const result = await apiRequest("/api/auth", {
          method: "POST",
          body: JSON.stringify({
            action: "changePassword",
            currentPassword: document.getElementById("currentPassword").value,
            newPassword: document.getElementById("newPassword").value,
            confirmPassword: document.getElementById("newPasswordConfirm").value
          })
        });
        currentUser = result.user;
        document.getElementById("passwordChangeForm").reset();
        await loadBackendState();
        await bootApp();
      } catch (error) {
        showDialog("密碼更新失敗", error.message || "目前無法更新密碼。");
      }
    });

    document.getElementById("requestForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = getCurrentUser();
      const payload = collectFormData();
      const records = getRecords();
      const existingIndex = records.findIndex((record) => record.id === payload.id);

      if (existingIndex >= 0 && !canEdit(records[existingIndex])) {
        showDialog("已超過可修改時間", "此請購單已超過 24 小時，如需修改請聯繫 IT 或相關工作人員。");
        return;
      }

      if (!payload.applicantSignature) {
        showDialog("尚未簽名", "請先完成申請人手寫簽名後再送出。");
        return;
      }

      payload.employeeId = user.employeeId;
      payload.employeeEmail = user.email || "";
      payload.updatedAt = new Date().toISOString();

      if (existingIndex >= 0) {
        payload.createdAt = records[existingIndex].createdAt;
        payload.approvalStatus = records[existingIndex].approvalStatus || createApprovalStatus(payload);
        records[existingIndex] = payload;
      } else {
        payload.id = crypto.randomUUID ? crypto.randomUUID() : `REQ-${Date.now()}`;
        payload.createdAt = new Date().toISOString();
        payload.approvalStatus = createApprovalStatus(payload);
        records.unshift(payload);
      }

      try {
        const syncResult = await syncToExternalDatabase(payload);
        const savedRequest = syncResult.request || payload;
        const savedIndex = records.findIndex((record) => record.id === savedRequest.id);
        if (savedIndex >= 0) records[savedIndex] = savedRequest;
        else records.unshift(savedRequest);
      } catch (error) {
        showDialog("送出失敗", error.message || "無法儲存請購單，請檢查後端設定後再試。");
        return;
      }

      saveRecords(records);
      showDialog("送出完成", "請購單已送出，資料已儲存至系統後端。");
      resetForm();
      renderHistory();
      renderDashboard();
    });

    document.getElementById("photoInput").addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
      const remaining = Math.max(0, 5 - uploadedPhotos.length);
      if (files.length > remaining) {
        showDialog("照片數量已達上限", "每張請購單最多可附加 5 張照片。");
      }
      for (const file of files) {
        if (uploadedPhotos.length >= 5) break;
        if (!allowedTypes.has(file.type) || file.size > 440 * 1024) {
          showDialog("照片格式或大小不符", "請使用 PNG、JPG 或 WebP，單張照片需小於 440 KB。");
          continue;
        }
        const dataUrl = await readFileAsDataUrl(file);
        if (dataUrl.length > 600000) {
          showDialog("照片檔案過大", "請縮小照片後再上傳，單張附件最多約 440 KB。");
          continue;
        }
        uploadedPhotos.push({
          id: crypto.randomUUID ? crypto.randomUUID() : `PHOTO-${Date.now()}-${Math.random()}`,
          name: file.name || "camera-photo.jpg",
          type: file.type,
          dataUrl,
          addedAt: new Date().toISOString()
        });
      }
      event.target.value = "";
      renderPhotos();
    });

    async function apiRequest(url, options = {}) {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {})
        }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "後端服務暫時無法使用");
      }
      return result;
    }

    async function loadBackendState() {
      const sessionResponse = await fetch("/api/auth", { credentials: "same-origin" });
      if (!sessionResponse.ok) {
        currentUser = null;
        return false;
      }

      const session = await sessionResponse.json();
      if (!session.ok || !session.user) {
        currentUser = null;
        return false;
      }

      currentUser = session.user;
      if (currentUser.mustChangePassword) return true;
      const requestResult = await apiRequest("/api/requests");
      saveRecords(requestResult.requests || []);

      if (isSuperAdmin(currentUser)) {
        const userResult = await apiRequest("/api/users");
        saveUsers(userResult.users || []);
      }
      return true;
    }

    async function bootApp() {
      if (!currentUser) {
        try {
          await loadBackendState();
        } catch {
          currentUser = null;
        }
      }

      const user = getCurrentUser();
      const passwordChangeRequired = Boolean(user?.mustChangePassword);
      document.getElementById("loginScreen").classList.toggle("hidden", Boolean(user));
      document.getElementById("passwordChangeScreen").classList.toggle("hidden", !passwordChangeRequired);
      document.getElementById("app").classList.toggle("hidden", !user || passwordChangeRequired);

      if (!user) return;
      if (passwordChangeRequired) {
        document.getElementById("passwordChangeIdentity").textContent = `${user.name || user.employeeId}（${user.employeeId}）`;
        return;
      }

      const assignedApprovalRole = approvalRoleLabel(user.approvalRole || user.role);
      const roleSummary = [roleLabel(user.role), assignedApprovalRole].filter(Boolean).join(" · ");
      document.getElementById("currentUser").textContent = `登入員工：${user.name || user.employeeId}（${user.employeeId}） | ${roleSummary}`;
      document.getElementById("departmentCode").readOnly = !isSuperAdmin(user);
      if (!isSuperAdmin(user)) document.getElementById("departmentCode").value = user.departmentCode || "";
      if (!document.getElementById("applicantName").value) {
        document.getElementById("applicantName").value = user.name || user.employeeId;
      }
      const canApprove = isSuperAdmin(user) || hasApprovalRole(user);
      const canAdmin = isSuperAdmin(user);
      const canSeeOverview = canAdmin || ["manager", "generalManager"].includes(user.role) || hasApprovalRole(user);
      document.getElementById("approvalTab").classList.toggle("hidden", !canApprove);
      document.getElementById("allRequestsTab").classList.toggle("hidden", !canSeeOverview);
      document.getElementById("adminTab").classList.toggle("hidden", !canAdmin);
      if (!document.getElementById("itemsBody").children.length) addItem();
      if (!document.getElementById("applyDate").value) document.getElementById("applyDate").value = todayString();
      renderHistory();
      renderApprovals();
      renderUsers();
      renderAllRequests();
      document.getElementById("workspaceApprovalAction").classList.toggle("hidden", !canApprove);
      document.getElementById("workspaceRecordsAction").classList.toggle("hidden", !canSeeOverview);
      document.getElementById("workspaceAdminAction").classList.toggle("hidden", !canAdmin);
      showView("workspace");
    }

    async function logout() {
      try {
        await apiRequest("/api/auth", { method: "POST", body: JSON.stringify({ action: "logout" }) });
      } catch {
        // The local state is cleared even if the remote logout request fails.
      }
      currentUser = null;
      location.reload();
    }

    function showView(view) {
      document.getElementById("workspaceView").classList.toggle("hidden", view !== "workspace");
      document.getElementById("formView").classList.toggle("hidden", view !== "form");
      document.getElementById("historyView").classList.toggle("hidden", view !== "history");
      document.getElementById("allRequestsView").classList.toggle("hidden", view !== "allRequests");
      document.getElementById("approvalView").classList.toggle("hidden", view !== "approvals");
      document.getElementById("adminView").classList.toggle("hidden", view !== "admin");
      document.getElementById("workspaceTab").classList.toggle("active", view === "workspace");
      document.getElementById("newTab").classList.toggle("active", view === "form");
      document.getElementById("historyTab").classList.toggle("active", view === "history");
      document.getElementById("allRequestsTab").classList.toggle("active", view === "allRequests");
      document.getElementById("approvalTab").classList.toggle("active", view === "approvals");
      document.getElementById("adminTab").classList.toggle("active", view === "admin");
      if (view === "workspace") renderDashboard();
      if (view === "history") renderHistory();
      if (view === "allRequests") renderAllRequests();
      if (view === "approvals") renderApprovals();
      if (view === "admin") renderUsers();
    }

    function renderDashboard() {
      const user = getCurrentUser();
      const list = document.getElementById("workspaceRecent");
      if (!user || !list) return;
      const mine = getRecords()
        .filter((record) => record.employeeId === user.employeeId)
        .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
      const pending = getRecords().filter(canApproveFromClient);
      const completed = mine.filter((record) => record.approvalStatus?.currentStep === "closed");
      document.getElementById("workspaceGreeting").textContent = `${user.name || user.employeeId}，這裡是你的請購與簽核概況。`;
      document.getElementById("workspaceMyCount").textContent = String(mine.length);
      document.getElementById("workspacePendingCount").textContent = String(pending.length);
      document.getElementById("workspaceDoneCount").textContent = String(completed.length);

      if (!mine.length) {
        list.innerHTML = "<div class='notice'>尚無請購紀錄，建立第一張請購單後會顯示在這裡。</div>";
        return;
      }
      list.innerHTML = mine.slice(0, 5).map((record) => {
        const title = record.vendorName || record.items?.[0]?.name || "未命名請購單";
        const editable = canEdit(record);
        return `
          <article class="record-row">
            <div><strong>${escapeHtml(title)}</strong><span>單號：${escapeHtml(record.id)}</span></div>
            <div><strong>${formatCurrency(record.totalAmount)}</strong><span>申請日期：${escapeHtml(record.applyDate || "-")}</span></div>
            <div><strong>${escapeHtml(record.approvalStatus?.label || "待簽核")}</strong><span>${editable ? "24 小時內可修改" : "已鎖定"}</span></div>
            <div class="record-actions">${editable
              ? `<button class="ghost-btn" type="button" data-edit-id="${escapeHtml(record.id)}">修改</button>`
              : `<button class="ghost-btn" type="button" data-locked>聯繫 IT</button>`}</div>
          </article>`;
      }).join("");
      list.querySelectorAll("[data-edit-id]").forEach((button) => {
        button.addEventListener("click", () => loadRecord(button.dataset.editId));
      });
      list.querySelectorAll("[data-locked]").forEach((button) => {
        button.addEventListener("click", () => showDialog("已超過可修改時間", "此請購單已超過 24 小時，如需修改請聯繫 IT 或相關工作人員。"));
      });
    }

    function addItem(item = {}) {
      const tbody = document.getElementById("itemsBody");
      const row = document.createElement("tr");

      itemColumns.forEach((column) => {
        const cell = document.createElement("td");
        const input = document.createElement("input");
        input.dataset.column = column;
        input.value = item[column] || "";

        if (["qty", "approvedQty", "price", "amount"].includes(column)) {
          input.type = "number";
          input.min = "0";
          input.className = "number-cell";
        }

        if (column === "amount") input.readOnly = true;
        if (["qty", "price"].includes(column)) input.addEventListener("input", () => updateRowAmount(row));

        cell.appendChild(input);
        row.appendChild(cell);
      });

      const actionCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "icon-btn";
      deleteButton.textContent = "x";
      deleteButton.title = "刪除此列";
      deleteButton.onclick = () => deleteItem(row);
      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);
      tbody.appendChild(row);
      updateRowAmount(row);
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function renderPhotos() {
      const preview = document.getElementById("photoPreview");
      if (!uploadedPhotos.length) {
        preview.innerHTML = "";
        return;
      }

      preview.innerHTML = uploadedPhotos.map((photo) => {
        const dataUrl = String(photo.dataUrl || "");
        const fileUrl = safeHttpUrl(photo.fileUrl || (photo.fileId ? `https://drive.google.com/open?id=${encodeURIComponent(photo.fileId)}` : ""));
        const image = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(dataUrl)
          ? `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(photo.name)}" loading="lazy" decoding="async">`
          : fileUrl
            ? `<a class="attachment-link" href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer">開啟雲端附件</a>`
            : `<span class="attachment-link">附件尚未上傳</span>`;
        return `
          <article class="photo-card">
            ${image}
            <footer>
              <span>${escapeHtml(photo.name)}</span>
              <button class="danger-btn" type="button" data-remove-photo="${escapeHtml(photo.id)}">刪除</button>
            </footer>
          </article>
        `;
      }).join("");
      preview.querySelectorAll("[data-remove-photo]").forEach((button) => {
        button.addEventListener("click", () => removePhoto(button.dataset.removePhoto));
      });
    }

    function removePhoto(id) {
      uploadedPhotos = uploadedPhotos.filter((photo) => photo.id !== id);
      renderPhotos();
    }

    function renderSignature() {
      const preview = document.getElementById("signaturePreview");
      if (!applicantSignature) {
        preview.textContent = "尚未簽名";
        return;
      }
      if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(applicantSignature)) {
        preview.innerHTML = `<img src="${escapeHtml(applicantSignature)}" alt="申請人簽名">`;
        return;
      }
      const url = safeHttpUrl(applicantSignature);
      preview.innerHTML = url
        ? `<a class="attachment-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">已簽名，開啟簽名檔</a>`
        : "已簽名";
    }

    function openSignatureDialog() {
      document.getElementById("signatureDialog").showModal();
      setupSignaturePad();
    }

    function closeSignatureDialog() {
      document.getElementById("signatureDialog").close();
    }

    function setupSignaturePad() {
      const canvas = document.getElementById("signaturePad");
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * scale);
      canvas.height = Math.floor(rect.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "#172033";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);

      if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(applicantSignature)) {
        const image = new Image();
        image.onload = () => ctx.drawImage(image, 0, 0, rect.width, rect.height);
        image.src = applicantSignature;
      }

      if (signaturePadReady) return;
      signaturePadReady = true;

      canvas.addEventListener("pointerdown", (event) => {
        isSigning = true;
        canvas.setPointerCapture(event.pointerId);
        const point = signaturePoint(event, canvas);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
      });

      canvas.addEventListener("pointermove", (event) => {
        if (!isSigning) return;
        const point = signaturePoint(event, canvas);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      });

      canvas.addEventListener("pointerup", () => {
        isSigning = false;
      });

      canvas.addEventListener("pointercancel", () => {
        isSigning = false;
      });
    }

    function signaturePoint(event, canvas) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    }

    function clearSignaturePad() {
      const canvas = document.getElementById("signaturePad");
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
    }

    function saveSignature() {
      const canvas = document.getElementById("signaturePad");
      applicantSignature = canvas.toDataURL("image/png");
      renderSignature();
      closeSignatureDialog();
    }

    function clearSignature() {
      applicantSignature = "";
      renderSignature();
    }

    function deleteItem(row) {
      const tbody = document.getElementById("itemsBody");
      if (tbody.children.length === 1) {
        showDialog("無法刪除", "請購明細至少需要保留一列。");
        return;
      }
      row.remove();
      updateTotal();
    }

    function updateRowAmount(row) {
      const qty = Number(row.querySelector('[data-column="qty"]').value) || 0;
      const price = Number(row.querySelector('[data-column="price"]').value) || 0;
      row.querySelector('[data-column="amount"]').value = qty * price || "";
      updateTotal();
    }

    function updateTotal() {
      const total = getItems().reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      document.getElementById("totalAmount").textContent = formatCurrency(total);
    }

    function checkedValues(containerId) {
      return Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map((input) => input.value);
    }

    function setCheckedValues(containerId, values) {
      document.querySelectorAll(`#${containerId} input`).forEach((input) => {
        input.checked = values.includes(input.value);
      });
    }

    function getItems() {
      return Array.from(document.querySelectorAll("#itemsBody tr")).map((row) => {
        const item = {};
        row.querySelectorAll("input[data-column]").forEach((input) => {
          item[input.dataset.column] = input.value;
        });
        return item;
      }).filter((item) => Object.values(item).some(Boolean));
    }

    function collectFormData() {
      const data = {
        id: document.getElementById("recordId").value,
        createdAt: document.getElementById("createdAt").value,
        categories: checkedValues("categoryChecks"),
        attachments: checkedValues("attachmentChecks"),
        photos: uploadedPhotos,
        applicantSignature,
        items: getItems(),
        totalAmount: getItems().reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
      };

      formFields.forEach((field) => {
        data[field] = document.getElementById(field).value.trim();
      });

      return data;
    }

    function resetForm() {
      document.getElementById("requestForm").reset();
      document.getElementById("recordId").value = "";
      document.getElementById("createdAt").value = "";
      document.getElementById("itemsBody").innerHTML = "";
      uploadedPhotos = [];
      applicantSignature = "";
      document.getElementById("applyDate").value = todayString();
      document.getElementById("departmentCode").value = currentUser?.departmentCode || "";
      document.getElementById("departmentCode").readOnly = !isSuperAdmin();
      document.getElementById("applicantName").value = currentUser?.name || currentUser?.employeeId || "";
      document.getElementById("formStatus").textContent = "新增表單";
      addItem();
      renderPhotos();
      renderSignature();
      updateTotal();
      showView("form");
    }

    function loadRecord(id) {
      const record = getRecords().find((entry) => entry.id === id);
      if (!record) return;

      if (!canEdit(record)) {
        showDialog("已超過可修改時間", "此請購單已超過 24 小時，如需修改請聯繫 IT 或相關工作人員。");
        return;
      }

      document.getElementById("recordId").value = record.id;
      document.getElementById("createdAt").value = record.createdAt;
      formFields.forEach((field) => {
        document.getElementById(field).value = record[field] || "";
      });
      setCheckedValues("categoryChecks", record.categories || []);
      setCheckedValues("attachmentChecks", record.attachments || []);
      uploadedPhotos = record.photos || [];
      applicantSignature = "";
      document.getElementById("itemsBody").innerHTML = "";
      (record.items && record.items.length ? record.items : [{}]).forEach(addItem);
      document.getElementById("formStatus").textContent = `編輯中：${record.id.slice(0, 8)}（需重新簽名並重新簽核）`;
      renderPhotos();
      renderSignature();
      updateTotal();
      showView("form");
    }

    function createApprovalStatus(record) {
      return {
        currentStep: "unitManager",
        label: "待單位主管簽核",
        route: [
          {
            step: "applicant",
            label: "申請人",
            actor: record.applicantName || record.employeeId,
            status: "signed",
            signedAt: new Date().toISOString()
          },
          {
            step: "unitManager",
            label: "單位主管",
            actor: resolveUnitManager(record.departmentCode),
            status: "pending",
            signedAt: ""
          },
          {
            step: "generalManager",
            label: "總經理",
            actor: resolveGeneralManager(),
            status: "waiting",
            signedAt: ""
          }
        ]
      };
    }

    function resolveUnitManager(departmentCode) {
      const code = String(departmentCode || "").trim().toUpperCase();
      const manager = getUsers().find((user) => (user.approvalRole || user.role) === "unitManager" && String(user.departmentCode || "").toUpperCase() === code);
      if (manager) return `${manager.name || manager.employeeId} (${manager.employeeId})`;
      return "依部門代號分派主管";
    }

    function resolveGeneralManager() {
      const manager = getUsers().find((user) => (user.approvalRole || user.role) === "generalManager");
      if (manager) return `${manager.name || manager.employeeId} (${manager.employeeId})`;
      return "總經理權限";
    }

    function roleLabel(role) {
      return {
        user: "一般員工",
        manager: "管理者",
        superAdmin: "最高權限者",
        admin: "最高權限者",
        "一般使用者": "一般員工",
        "一般員工": "一般員工",
        "管理者": "管理者",
        "最高權限": "最高權限者",
        "最高權限者": "最高權限者"
      }[role] || "一般員工";
    }

    function approvalRoleLabel(role) {
      return {
        unitManager: "單位主管",
        generalManager: "總經理",
        "單位主管": "單位主管",
        "總經理": "總經理"
      }[role] || "";
    }

    async function saveUserRole() {
      const current = getCurrentUser();
      if (!isSuperAdmin(current)) {
        showDialog("權限不足", "只有最高權限者可以調整系統權限與簽核職務。");
        return;
      }

      const employeeId = document.getElementById("roleEmployeeId").value.trim();
      if (!employeeId) {
        showDialog("缺少員工編號", "請輸入要設定的人員員工編號。");
        return;
      }

      try {
        const result = await apiRequest("/api/users", {
          method: "POST",
          body: JSON.stringify({
            employeeId,
            email: document.getElementById("roleEmail").value.trim(),
            departmentCode: document.getElementById("roleDepartment").value.trim().toUpperCase(),
            name: document.getElementById("roleName").value.trim(),
            role: document.getElementById("roleType").value,
            approvalRole: document.getElementById("approvalRoleType").value,
            password: document.getElementById("adminTempPassword").value,
            confirmPassword: document.getElementById("adminTempPasswordConfirm").value,
            active: true
          })
        });
        const users = getUsers().filter((user) => user.employeeId !== result.user.employeeId);
        users.push(result.user);
        saveUsers(users);
        renderUsers();
        document.getElementById("adminTempPassword").value = "";
        document.getElementById("adminTempPasswordConfirm").value = "";
        const assigned = [roleLabel(result.user.role), approvalRoleLabel(result.user.approvalRole)].filter(Boolean).join("、");
        showDialog("帳號與權限已儲存", result.user.mustChangePassword
          ? `${employeeId} 已設定為 ${assigned}。請安全交付臨時密碼，員工首次登入需更換。`
          : `${employeeId} 已設定為 ${assigned}。`);
      } catch (error) {
        showDialog("權限儲存失敗", error.message || "無法更新帳號權限。");
      }
    }

    function canApproveFromClient(record) {
      const user = getCurrentUser();
      if (!user || !record) return false;
      const currentStep = record.approvalStatus?.currentStep;
      if (!["unitManager", "generalManager"].includes(currentStep)) return false;
      const routeStep = record.approvalStatus?.route?.find((step) => step.step === currentStep);
      if (routeStep && routeStep.status !== "pending") return false;
      if (isSuperAdmin(user)) return true;
      if ((user.approvalRole === "unitManager" || user.role === "unitManager" || user.role === "單位主管") && currentStep === "unitManager") {
        return String(user.departmentCode || "").toUpperCase() === String(record.departmentCode || "").toUpperCase();
      }
      return (user.approvalRole === "generalManager" || user.role === "generalManager" || user.role === "總經理")
        && currentStep === "generalManager";
    }

    async function handleApprovalAction(id, action) {
      const note = action === "reject" ? window.prompt("請輸入退回原因（可留空）") || "" : "";
      try {
        const result = await apiRequest("/api/approval-action", {
          method: "POST",
          body: JSON.stringify({ id, action, note })
        });
        const records = getRecords().filter((record) => record.id !== result.request.id);
        records.push(result.request);
        saveRecords(records);
        renderApprovals();
        showDialog("簽核完成", `請購單已更新為「${result.status}」。`);
      } catch (error) {
        showDialog("簽核失敗", error.message || "目前無法完成簽核。");
      }
    }

    function renderApprovals() {
      const list = document.getElementById("approvalList");
      if (!list) return;
      const pending = getRecords().filter(canApproveFromClient);
      if (!pending.length) {
        list.innerHTML = "<div class='notice'>目前沒有待處理的請購單。</div>";
        return;
      }

      list.innerHTML = pending.map((record) => {
        const title = record.vendorName || record.items?.[0]?.name || "未命名請購單";
        return `
          <article class="record-row">
            <div><strong>${escapeHtml(title)}</strong><span>單號：${escapeHtml(record.id)}</span></div>
            <div><strong>${escapeHtml(record.applicantName || record.employeeId)}</strong><span>部門：${escapeHtml(record.departmentCode || "-")}</span></div>
            <div><strong>${escapeHtml(record.approvalStatus?.label || "待簽核")}</strong><span>金額：${formatCurrency(record.totalAmount)}</span></div>
            <div class="record-actions">
              <button class="primary-btn" type="button" data-approval-action="approve" data-request-id="${escapeHtml(record.id)}">核准</button>
              <button class="danger-btn" type="button" data-approval-action="reject" data-request-id="${escapeHtml(record.id)}">退回</button>
            </div>
          </article>
        `;
      }).join("");
      list.querySelectorAll("[data-approval-action]").forEach((button) => {
        button.addEventListener("click", () => handleApprovalAction(button.dataset.requestId, button.dataset.approvalAction));
      });
    }

    function renderUsers() {
      const list = document.getElementById("usersList");
      if (!list) return;

      const current = getCurrentUser();
      if (!isSuperAdmin(current)) {
        list.innerHTML = "";
        return;
      }

      const users = getUsers();
      list.innerHTML = users.map((user) => `
        <article class="role-row">
          <div>
            <strong>${escapeHtml(user.employeeId)} <span class="approval-badge">${roleLabel(user.role)}${user.approvalRole ? ` · ${approvalRoleLabel(user.approvalRole)}` : ""}</span></strong>
            <span>${escapeHtml(user.name || "未填姓名")} | ${escapeHtml(user.departmentCode || "未設定部門")} | ${escapeHtml(user.email || "未設定信箱")} | ${user.mustChangePassword ? "首次登入待改密碼" : user.active ? "啟用中" : "停用中"}</span>
          </div>
          <button class="ghost-btn" type="button" data-edit-user="${escapeHtml(user.employeeId)}">編輯</button>
        </article>
      `).join("");
      list.querySelectorAll("[data-edit-user]").forEach((button) => {
        button.addEventListener("click", () => fillRoleForm(button.dataset.editUser));
      });
    }

    function fillRoleForm(employeeId) {
      const user = findUser(employeeId);
      if (!user) return;
      document.getElementById("roleEmployeeId").value = user.employeeId;
      document.getElementById("roleEmail").value = user.email || "";
      document.getElementById("roleDepartment").value = user.departmentCode || "";
      document.getElementById("roleName").value = user.name || "";
      document.getElementById("roleType").value = user.role || "user";
      document.getElementById("approvalRoleType").value = user.approvalRole || "";
      document.getElementById("adminTempPassword").value = "";
      document.getElementById("adminTempPasswordConfirm").value = "";
    }

    function renderAllRequests() {
      const list = document.getElementById("allRequestsList");
      if (!list) return;
      const records = getRecords().slice().sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
      if (!records.length) {
        list.innerHTML = "<div class='notice'>目前沒有可檢視的請購單。</div>";
        return;
      }
      list.innerHTML = records.map((record) => `
        <article class="record-row">
          <div><strong>${escapeHtml(record.vendorName || record.items?.[0]?.name || "未命名請購單")}</strong><span>單號：${escapeHtml(record.id)}</span></div>
          <div><strong>${escapeHtml(record.applicantName || record.employeeId)}</strong><span>${escapeHtml(record.departmentCode || "未設定部門")} · ${escapeHtml(record.applyDate || "-")}</span></div>
          <div><strong>${escapeHtml(record.approvalStatus?.label || "待簽核")}</strong><span>${formatCurrency(record.totalAmount)}</span></div>
          <div><span>${escapeHtml(formatDateTime(record.updatedAt || record.createdAt))}</span></div>
        </article>
      `).join("");
    }

    function renderHistory() {
      const user = getCurrentUser();
      const list = document.getElementById("recordsList");
      const records = getRecords().filter((record) => record.employeeId === user.employeeId);

      if (!records.length) {
        list.innerHTML = "<div class='notice'>目前尚無請購紀錄。</div>";
        return;
      }

      list.innerHTML = records.map((record) => {
        const editable = canEdit(record);
        const approved = window.AiwaTriplicateTemplate.isFullyApproved(record);
        const title = record.vendorName || record.items?.[0]?.name || "未命名請購單";
        const statusLabel = record.approvalStatus?.label || "待單位主管簽核";
        const editButton = editable
          ? `<button class="primary-btn" type="button" data-edit-id="${escapeHtml(record.id)}">修改</button>`
          : `<button class="ghost-btn" type="button" data-locked>聯繫 IT</button>`;
        const printButton = approved
          ? `<button class="ghost-btn" type="button" data-triplicate-id="${escapeHtml(record.id)}">列印 / 另存三聯 PDF</button>`
          : "";

        return `
          <article class="record-row">
            <div><strong>${escapeHtml(title)}</strong><span>單號：${escapeHtml(record.id)}</span></div>
            <div><strong>${formatCurrency(record.totalAmount)}</strong><span>申請日期：${escapeHtml(record.applyDate || "-")}</span></div>
            <div><strong>${escapeHtml(statusLabel)}</strong><span>${editable ? "24 小時內可修改" : approved ? "簽核完成" : "已鎖定，請聯繫 IT"}</span></div>
            <div class="record-actions">${editButton}${printButton}</div>
          </article>
        `;
      }).join("");
      list.querySelectorAll("[data-edit-id]").forEach((button) => {
        button.addEventListener("click", () => loadRecord(button.dataset.editId));
      });
      list.querySelectorAll("[data-locked]").forEach((button) => {
        button.addEventListener("click", () => showDialog("已超過可修改時間", "此請購單已超過 24 小時，如需修改請聯繫 IT 或相關工作人員。"));
      });
      list.querySelectorAll("[data-triplicate-id]").forEach((button) => {
        button.addEventListener("click", () => openTriplicatePrint(button.dataset.triplicateId));
      });
    }

    function openTriplicatePrint(id) {
      const record = getRecords().find((entry) => entry.id === id);
      if (!record || record.employeeId !== currentUser?.employeeId) {
        showDialog("無法產生三聯單", "只能下載自己送出的請購單。");
        return;
      }
      if (!window.AiwaTriplicateTemplate.isFullyApproved(record)) {
        showDialog("尚未完成簽核", "請購單完成單位主管與總經理核准後，才能產生三聯單。");
        return;
      }

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        showDialog("無法開啟列印視窗", "請允許此網站開啟彈出視窗後，再試一次。");
        return;
      }

      try {
        printWindow.opener = null;
        printWindow.addEventListener("load", () => {
          const imagesReady = Promise.all(Array.from(printWindow.document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            });
          }));
          Promise.race([imagesReady, new Promise((resolve) => window.setTimeout(resolve, 3000))]).then(() => {
            if (printWindow.closed) return;
            printWindow.focus();
            printWindow.print();
          });
        }, { once: true });
        printWindow.document.open();
        printWindow.document.write(window.AiwaTriplicateTemplate.renderDocument(record, {
          logoUrl: new URL("/assets/aiwa-logo.svg", window.location.href).href,
          printedAt: new Date().toISOString()
        }));
        printWindow.document.close();
      } catch (error) {
        printWindow.close();
        showDialog("三聯單產生失敗", error.message || "目前無法產生列印文件。");
      }
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function safeHttpUrl(value) {
      try {
        const url = new URL(String(value || ""), window.location.href);
        const allowedHosts = new Set(["drive.google.com", "drive.usercontent.google.com", "docs.google.com"]);
        return url.protocol === "https:" && allowedHosts.has(url.hostname.toLowerCase()) ? url.href : "";
      } catch {
        return "";
      }
    }

    async function syncToExternalDatabase(payload) {
      const response = await fetch("/api/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "儲存請購單失敗");
      }

      return result;

    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "show-view") showView(button.dataset.view);
      else if (action === "logout") logout();
      else if (action === "reset-form") resetForm();
      else if (action === "add-item") addItem();
      else if (action === "open-photo-picker") document.getElementById("photoInput").click();
      else if (action === "open-signature") openSignatureDialog();
      else if (action === "clear-signature") clearSignature();
      else if (action === "save-user-role") saveUserRole();
      else if (action === "close-dialog") closeDialog();
      else if (action === "clear-signature-pad") clearSignaturePad();
      else if (action === "close-signature-dialog") closeSignatureDialog();
      else if (action === "save-signature") saveSignature();
    });

    bootApp();
