const createSql = `
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS sentiment TEXT;
  CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
`;

module.exports = { createSql };