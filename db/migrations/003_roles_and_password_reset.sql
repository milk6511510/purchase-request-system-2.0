BEGIN;

ALTER TABLE purchase_request.users
  ADD COLUMN IF NOT EXISTS approval_role TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE purchase_request.users
SET
  approval_role = CASE
    WHEN approval_role <> '' THEN approval_role
    WHEN role IN ('unitManager', '單位主管') THEN 'unitManager'
    WHEN role IN ('generalManager', '總經理') THEN 'generalManager'
    ELSE ''
  END,
  role = CASE
    WHEN role IN ('admin', '最高權限', '最高權限管理者', '最高權限者') THEN 'superAdmin'
    WHEN role IN ('manager', '管理者', 'generalManager', '總經理') THEN 'manager'
    ELSE 'user'
  END;

UPDATE purchase_request.users
SET name = '李柏勳', role = 'superAdmin', active = TRUE, updated_at = NOW()
WHERE UPPER(employee_id) = 'A001';

INSERT INTO purchase_request.schema_migrations (version)
VALUES ('003_roles_and_password_reset')
ON CONFLICT (version) DO NOTHING;

COMMIT;
