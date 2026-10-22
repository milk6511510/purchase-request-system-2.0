# 公司內部請購單系統

目前專案已包含前台請購表單、後端 API、後台權限管理、簽核流程、24 小時修改限制、照片／簽名附件欄位與 Google Sheet 資料同步。

## 功能

- 員工編號、公司信箱與密碼註冊／登入
- 伺服器端 session，不再以瀏覽器 `localStorage` 作為權限依據
- 一般員工只能查看自己的請購單
- 單位主管依部門代號查看並簽核
- 總經理查看主管核准後的請購單
- A001 最高權限管理者管理人員、部門與角色
- 送出後 24 小時內可由申請人修改，逾時由後端拒絕
- 簽核退回或註銷時可寄送通知信
- Google Sheet 保存主表、品項、簽核紀錄與使用者權限
- 可選擇將照片與手寫簽名上傳到 Google Drive 私有資料夾

## Google Sheet 分頁

- `請購主表`
- `品項明細`
- `簽核紀錄`
- `使用者權限`
- `系統設定`

`使用者權限` 需要保留以下欄位，後端會在缺少時自動補上 `密碼雜湊` 欄位：

`員工編號、姓名、公司信箱、部門代號、權限、啟用、建立時間、更新時間、備註、密碼雜湊`

## Vercel 環境變數

請在 Vercel Project Settings → Environment Variables 設定，不能提交到 GitHub：

```env
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_FOLDER_ID=
AUTH_SECRET=
COMPANY_EMAIL_DOMAIN=
ADMIN_EMPLOYEE_ID=A001
ADMIN_EMAIL=
ADMIN_INITIAL_PASSWORD=
SELF_REGISTER_AUTO_ACTIVATE=false
RESEND_API_KEY=
MAIL_FROM=請購單系統 <noreply@example.com>
```

### 初次設定順序

1. 建立或使用 Google Cloud Service Account。
2. 將 Google Sheet 分享給 Service Account email，權限給編輯者。
3. 若要保存照片與簽名，建立 Google Drive 私有資料夾，分享給 Service Account，填入 `GOOGLE_DRIVE_FOLDER_ID`。
4. 設定 `AUTH_SECRET` 為隨機長字串。
5. 設定 `COMPANY_EMAIL_DOMAIN`，例如 `example.com`，不要包含 `@`。
6. 設定 `ADMIN_INITIAL_PASSWORD`，第一次使用 A001 登入後，再由後台管理人員。
7. 設定完成後重新部署 Vercel，環境變數才會套用到新的部署。

## API

- `GET/POST /api/auth`：登入、註冊、查詢 session、登出
- `GET/POST /api/users`：最高權限帳號管理
- `GET /api/requests`：依登入者角色取得可查看的請購單
- `POST /api/submit-request`：新增或更新請購單
- `POST /api/approval-action`：核准、退回、註銷

## 本機檢查

```bash
pnpm check
```

本機測試需要準備 `.env.local`，不要把正式私鑰放進 GitHub。
