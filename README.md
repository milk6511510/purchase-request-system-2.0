# 公司內部請購單系統

目前專案已包含登入後工作台、員工帳號管理、請購流程、權限簽核及 Neon PostgreSQL 儲存層。設定 `DATABASE_URL` 後，帳號、請購單、明細和簽核紀錄會存入 Neon；未設定時仍使用既有 Google Sheet 相容路徑。

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

Neon 專案：`AIWA purchase-request-system`。目前應用程式資料表只建立在 `development` 分支，正式 `production` 分支保持未修改。

依序執行 `db/migrations/001_initial_schema.sql`、`002_signature_binary.sql` 與 `003_roles_and_password_reset.sql` 後，資料會放在 `purchase_request` schema。Vercel 執行環境請設定伺服器端 `DATABASE_URL`，建議使用 Neon pooled connection string；不要加上 `NEXT_PUBLIC_` 前綴，也不要提交到 GitHub。正式切換前，須先將正式分支建立相同 schema，並另外規劃舊 Google Sheet 帳號與請購資料匯入。

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

本機開發分支的 A001 密碼重設指令為 `pnpm admin:reset`。在可互動的 PowerShell 終端輸入 `RESET` 後，可設定臨時密碼；不足 8 個字元的密碼登入後會被強制更換為至少 8 個字元的新密碼。指令會拒絕非 development endpoint，不會清除其他員工帳號。不要把初始密碼寫入程式碼或文件。正式環境請另外設定長且唯一的管理員初始密碼。

員工不可自行註冊。最高權限者在「權限管理」建立帳號、設定系統權限與簽核職務，並設定至少 8 個字元的臨時密碼；請透過公司核准方式交付員工。新建帳號或重設密碼後，員工首次登入必須自行更換密碼。

照片附件目前使用 Google Drive：須設定 `GOOGLE_DRIVE_FOLDER_ID` 和 Service Account 權限，否則帶照片的請購單會被拒絕送出。手寫簽名若未設定 Drive，會以小型 BYTEA 附件存放在 Neon；大量圖片不會以 Base64 寫入資料庫。

## Google Sheet 相容模式

只有在沒有設定 `DATABASE_URL` 時，後端才會使用下列既有 Google Sheet 分頁。設定 Neon 後，不會自動搬移這些舊資料。

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

### 初次設定順序

1. 在 Neon `development` 分支依序執行三個 migration，使用 pooled connection string 設定應用程式的 `DATABASE_URL`。
2. 設定 `AUTH_SECRET` 為隨機長字串，設定公司信箱網域和 A001 初始密碼。
3. 若要保存照片與簽名，建立 Google Drive 私有資料夾，分享給 Service Account，填入 `GOOGLE_DRIVE_FOLDER_ID`。
4. 確認登入、請購及簽核資料都能寫入 development 後，再規劃 production 分支、既有資料匯入與 Vercel 環境變數。
5. 目前沒有執行 Vercel 部署，也沒有自動匯入舊 Google Sheet 資料。

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
