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

Google Sheet 已建立：

https://docs.google.com/spreadsheets/d/1QN3PsmJXxpBUTVKmMhUi2jaJxfp1cUbZqdz8y5vi6oI

分頁：

- `請購主表`
- `品項明細`
- `簽核紀錄`
- `使用者權限`
- `系統設定`

## 環境變數

請在 Vercel 專案後台設定，不能提交到 GitHub。

```env
GOOGLE_SHEET_ID=1QN3PsmJXxpBUTVKmMhUi2jaJxfp1cUbZqdz8y5vi6oI
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
NOTION_TOKEN=
NOTION_DATABASE_ID=
RESEND_API_KEY=
MAIL_FROM=請購單系統 <noreply@example.com>
```

## 正式資料保存建議

- 表單主資料寫入 Google Sheet 與 Notion。
- 照片與簽名建議上傳 Google Drive 後，在表格內保存檔案連結。
- 通知信可使用 Resend、Gmail API 或公司 SMTP。
- API key、Notion token、Google private key 都只能放在 Vercel Environment Variables。

