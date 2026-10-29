BEGIN;

ALTER TABLE purchase_request.attachments
  ADD COLUMN IF NOT EXISTS file_data BYTEA;

INSERT INTO purchase_request.schema_migrations (version)
VALUES ('002_signature_binary')
ON CONFLICT (version) DO NOTHING;

COMMIT;
