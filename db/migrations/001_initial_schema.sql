BEGIN;

CREATE SCHEMA IF NOT EXISTS purchase_request;

CREATE TABLE IF NOT EXISTS purchase_request.schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_request.users (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  department_code TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '一般使用者',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  password_hash TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON purchase_request.users (LOWER(email))
  WHERE email <> '';

CREATE TABLE IF NOT EXISTS purchase_request.requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  employee_email TEXT NOT NULL DEFAULT '',
  applicant_name TEXT NOT NULL DEFAULT '',
  department_code TEXT NOT NULL DEFAULT '',
  request_type TEXT NOT NULL DEFAULT '',
  apply_date TEXT NOT NULL DEFAULT '',
  need_date TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL DEFAULT '',
  vendor_tax_id TEXT NOT NULL DEFAULT '',
  tax_type TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status_label TEXT NOT NULL DEFAULT '',
  current_step TEXT NOT NULL DEFAULT '',
  source_system TEXT NOT NULL DEFAULT 'web',
  external_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS requests_source_external_ref_unique
  ON purchase_request.requests (source_system, external_ref)
  WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_employee_created_idx
  ON purchase_request.requests (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_department_status_idx
  ON purchase_request.requests (department_code, current_step, updated_at DESC);

CREATE TABLE IF NOT EXISTS purchase_request.request_items (
  request_id TEXT NOT NULL REFERENCES purchase_request.requests(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (request_id, item_index)
);

CREATE TABLE IF NOT EXISTS purchase_request.approval_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_request.requests(id) ON DELETE CASCADE,
  action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  step TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  actor_employee_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  notification_email TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS approval_logs_request_time_idx
  ON purchase_request.approval_logs (request_id, action_at DESC);

CREATE TABLE IF NOT EXISTS purchase_request.attachments (
  request_id TEXT NOT NULL REFERENCES purchase_request.requests(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, attachment_id)
);

INSERT INTO purchase_request.schema_migrations (version)
VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
