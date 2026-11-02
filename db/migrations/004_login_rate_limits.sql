BEGIN;

CREATE TABLE IF NOT EXISTS purchase_request.login_rate_limits (
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('account', 'ip')),
  bucket_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_type, bucket_hash)
);

CREATE INDEX IF NOT EXISTS login_rate_limits_updated_at_idx
  ON purchase_request.login_rate_limits (updated_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aiwa_purchase_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_request.login_rate_limits TO aiwa_purchase_app';
  END IF;
END $$;

INSERT INTO purchase_request.schema_migrations (version)
VALUES ('004_login_rate_limits')
ON CONFLICT (version) DO NOTHING;

COMMIT;
