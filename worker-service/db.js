const { Pool } = require('pg');
const { createSql } = require('../schema');

// Prefer DATABASE_URL, falls back to discrete PG* env vars managed by pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL || undefined });

async function ensureSchema() {
  await pool.query(createSql);
}

async function init() {
  await ensureSchema();
}

async function getUnprocessedMessages(limit = 10) {
  const sql = `
    SELECT m.id, m.user_id AS "userId", m.message, m.metadata, m.created_at AS "createdAt"
    FROM messages m
    WHERE COALESCE(m.metadata->>'augmented', 'false') <> 'true'
      AND (m.sentiment IS NULL OR m.sentiment = '')
    ORDER BY m.created_at ASC
    LIMIT $1;
  `;
  const result = await pool.query(sql, [limit]);
  return result.rows;
}

async function updateMessageSentiment(record) {
  const updateSql = `
    UPDATE messages
    SET
      user_id   = $2,
      message   = $3,
      metadata  = $4::jsonb,
      created_at = $5::timestamptz,
      sentiment = $6
    WHERE id = $1
    RETURNING id;
  `;
  const params = [
    record.id,
    record.userId,
    record.message,
    JSON.stringify(record.metadata || {}),
    record.createdAt,
    record.sentiment || null,
  ];
  const result = await pool.query(updateSql, params);
  return result.rows[0].id;
}

async function close() {
  await pool.end();
}

module.exports = {
  init,
  getUnprocessedMessages,
  updateMessageSentiment,
  close,
  pool,
}; 