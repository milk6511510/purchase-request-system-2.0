# 公司內部請購單系統

目前專案已包含登入後工作台、員工帳號管理、請購流程、權限簽核及 Neon PostgreSQL 儲存層。Vercel 正式站使用 Neon；Google Sheet 目前僅保留舊版相容路徑，尚未與 Neon 同步寫入。

## 功能

- 員工帳號由最高權限者建立並核發臨時密碼；首次登入強制改密碼
- 伺服器端 session，不再以瀏覽器 `localStorage` 作為權限依據
- 一般員工只能查看自己的請購單
- 管理者可查看請購總覽，但不能指派系統權限
- 最高權限者可管理帳號、系統權限、資料及完整 APP 設定
- 簽核職務獨立指派：單位主管依部門簽核，總經理負責最後簽核
- A001 最高權限者為李柏勳；臨時初始密碼須在首次登入後立即更換
- 送出後 24 小時內可由申請人修改，逾時由後端拒絕
- 簽核退回或註銷時可寄送通知信
- Neon 保存帳號、請購主資料、品項、附件索引與簽核紀錄
- 可選擇將照片與手寫簽名上傳到 Google Drive 私有資料夾；未設定 Drive 時，小型手寫簽名會以二進位附件存 Neon
- Google 表單匯入與 Excel 匯出尚未接通；資料表已預留來源系統與外部識別欄位

## Neon 資料庫

Neon 專案：`AIWA purchase-request-system`。`development` 與 `production` 分支都已建立 `purchase_request` schema，production migrations 已先在暫存分支驗證再套用。

依序執行 `db/migrations/001_initial_schema.sql`、`002_signature_binary.sql` 與 `003_roles_and_password_reset.sql` 後，資料會放在 `purchase_request` schema。Vercel Production 已設定伺服器端 Neon pooled `DATABASE_URL` 與 `AUTH_SECRET`；環境變數不提交到 GitHub。舊 Google Sheet 帳號與請購資料尚未匯入。

應用程式使用受限資料庫角色，不需要資料庫管理員權限。新分支建立 schema 後，以 Neon SQL Editor 的管理者身分建立執行角色並授權：

```sql
CREATE ROLE aiwa_purchase_app LOGIN PASSWORD '請在密碼管理器產生隨機密碼';
GRANT USAGE ON SCHEMA purchase_request TO aiwa_purchase_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA purchase_request TO aiwa_purchase_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA purchase_request TO aiwa_purchase_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA purchase_request
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aiwa_purchase_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA purchase_request
  GRANT USAGE, SELECT ON SEQUENCES TO aiwa_purchase_app;
```

正式資料庫已建立 A001 最高權限帳號，帳號密碼只以雜湊保存，沒有寫入程式碼或 GitHub。新環境可透過 Vercel 的 `ADMIN_INITIAL_PASSWORD` 在 A001 尚不存在時建立初始管理員；既有帳號不會因修改此變數而重設密碼。

本機 development 分支的 A001 密碼重設指令為 `pnpm admin:reset`。在可互動的 PowerShell 終端輸入 `RESET` 後可設定臨時密碼；不足 8 個字元時，首次登入必須改成至少 8 個字元的新密碼。此指令會拒絕非 development endpoint，不會清除其他員工帳號。

員工不可自行註冊。最高權限者在「權限管理」建立帳號、設定系統權限與簽核職務，並設定至少 8 個字元的臨時密碼；請透過公司核准方式交付員工。新建帳號或重設密碼後，員工首次登入必須自行更換密碼。

照片附件目前使用 Google Drive：須設定 `GOOGLE_DRIVE_FOLDER_ID` 和 Service Account 權限，否則帶照片的請購單會被拒絕送出。手寫簽名若未設定 Drive，會以小型 BYTEA 附件存放在 Neon；大量圖片不會以 Base64 寫入資料庫。

## Google Sheet 相容模式

只有在沒有設定 `DATABASE_URL` 時，後端才會使用下列既有 Google Sheet 分頁。設定 Neon 後不會自動搬移舊資料；目前也沒有 Neon 到 Google Sheet 的自動同步。

- `請購主表`
- `品項明細`
- `簽核紀錄`
- `使用者權限`
- `系統設定`

`使用者權限` 需要保留以下欄位，後端會在缺少時自動補上 `密碼雜湊` 欄位：

`員工編號、姓名、公司信箱、部門代號、系統權限、簽核職務、啟用、首次登入須改密碼、建立時間、更新時間、備註、密碼雜湊`

## Vercel 環境變數

請在 Vercel Project Settings → Environment Variables 設定，不能提交到 GitHub：

```env
DATABASE_URL=
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_FOLDER_ID=
AUTH_SECRET=
COMPANY_EMAIL_DOMAIN=
ADMIN_EMPLOYEE_ID=A001
ADMIN_EMAIL=
ADMIN_INITIAL_PASSWORD=
ADMIN_INITIAL_FORCE_CHANGE=true
RESEND_API_KEY=
MAIL_FROM=請購單系統 <noreply@example.com>
```

### 環境設定

1. 新環境先在 development 分支驗證 migrations，再套用到 production 分支。
2. Vercel Production 設定受限資料庫角色的 pooled `DATABASE_URL` 與隨機 `AUTH_SECRET`。
3. 新環境可另外設定 `ADMIN_INITIAL_PASSWORD`；既有 A001 帳號需走正式密碼重設流程。
4. 若要保存照片，建立 Google Drive 私有資料夾並授權 Service Account，再設定 `GOOGLE_DRIVE_FOLDER_ID`。
5. 正式站：[purchase-request-system-2-0.vercel.app](https://purchase-request-system-2-0.vercel.app/)。目前請購主資料以 Neon 為準；Google Sheet 雙寫與舊資料匯入尚未完成。

## API

- `GET/POST /api/auth`：登入、查詢 session、登出、首次登入改密碼；自行註冊已停用
- `GET/POST /api/users`：最高權限帳號管理
- `GET /api/requests`：依登入者角色取得可查看的請購單
- `POST /api/submit-request`：新增或更新請購單
- `POST /api/approval-action`：核准、退回、註銷

## 本機檢查

```bash
pnpm check
pnpm preview
```

本機預覽預設只監聽 `127.0.0.1:8788`，並使用 `.env.local` 連接資料庫。員工帳號只由最高權限者建立；部署時請設定公司信箱網域與安全的管理員密碼，不要把正式私鑰放進 GitHub。
