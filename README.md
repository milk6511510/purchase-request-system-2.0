# 請購單系統

公司內部請購單雛形，包含登入、首次公司信箱註冊、請購表單、照片附件、手寫簽名、24 小時內修改、過往紀錄與權限管理。

## 部署方式

此專案可部署到 Vercel。

- 首頁：`/`
- 主檔案：`purchase_request_form.html`
- Vercel 設定：`vercel.json`
- API 路徑：`api/`

## 測試帳號

- 測試密碼：`demo`
- `A001`：預設最高權限管理者
- 其他員工編號：第一次登入需填公司信箱

## 後台資料庫

Google Sheet 已建立，正式部署時請由管理員將實際試算表 ID 設定到 Vercel 的 Environment Variables。

分頁：

- `請購主表`
- `品項明細`
- `簽核紀錄`
- `使用者權限`
- `系統設定`

## 環境變數

請在 Vercel 專案後台設定，不能提交到 GitHub。

```env
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
RESEND_API_KEY=
MAIL_FROM=請購單系統 <noreply@example.com>
```

## 正式資料保存建議

- 表單主資料、品項明細與簽核紀錄寫入 Google Sheet。
- 帳號與簽核角色寫入 Google Sheet 的 `使用者權限` 分頁。
- 目前 HTML 預覽版的登入、權限與過往清單仍使用瀏覽器 `localStorage`；正式上線需再由後端 API 讀寫上述分頁，並加上伺服器端登入驗證。
- 照片與簽名建議上傳 Google Drive 後，在表格內保存檔案連結。
- 通知信可使用 Resend、Gmail API 或公司 SMTP。
- API key 與 Google private key 都只能放在 Vercel Environment Variables。
