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

async function insertMessage(record) {
  const insertSql = `
    INSERT INTO messages (id, user_id, message, metadata, created_at)
    VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
    RETURNING id;
  `;
  const params = [
    record.id,
    record.userId,
    record.message,
    JSON.stringify(record.metadata || {}),
    record.createdAt,
  ];
  const result = await pool.query(insertSql, params);
  return result.rows[0].id;
}

async function findMessages(userIdOrNull) {
  const selectSql = `
    SELECT 
      id,
      user_id AS "userId",
      message,
      metadata,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      sentiment
    FROM messages
    WHERE ($1::text IS NULL OR user_id = $1)
    ORDER BY created_at DESC
    LIMIT 100;
  `;
  const params = [userIdOrNull || null];
  const result = await pool.query(selectSql, params);
  return result.rows;
}

async function healthCheck() {
  const result = await pool.query('SELECT 1 as ok');
  return result.rows[0].ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = {
  init,
  insertMessage,
  findMessages,
  healthCheck,
  close,
  pool,
}; 