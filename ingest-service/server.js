const express = require('express');
const { z } = require('zod');
const { nanoid } = require('nanoid');
require('dotenv').config();
const pino = require('pino');
const pinoHttp = require('pino-http');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

// --- Middleware
app.use(express.json({ limit: '100kb' }));

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existingRequestId = req.headers['x-request-id'] || req.headers['request-id'];
      const id = existingRequestId ? String(existingRequestId) : nanoid();
      res.setHeader('x-request-id', id);
      return id;
    },
  })
);

// Initialize schema on boot but do not crash the process if DB is unreachable; log error instead
db.init().catch((error) => {
  logger.error({ err: error }, 'Failed to ensure database schema. Check your PostgreSQL connection settings.');
});

// Zod schema
const ChatMessageSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  message: z.string().min(1).max(4000),
  timestamp: z
    .string()
    .datetime()
    .optional()
    .describe('ISO-8601 timestamp; server will set if missing'),
  // optional metadata bucket
  metadata: z.record(z.any()).optional(),
});

// Validation helper
function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'ValidationError',
        details: parsed.error.flatten(),
      });
    }
    req.validated = parsed.data;
    next();
  };
}

// Health check
app.get('/health', async (_req, res) => {
  try {
    const dbOk = await db.healthCheck();
    res.json({ status: 'ok', db: dbOk ? 'up' : 'unknown' });
  } catch (_error) {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

// POST endpoint to ingest a chat message
app.post('/v1/messages', validate(ChatMessageSchema), async (req, res) => {
  const { userId, message, timestamp, metadata } = req.validated;

  const record = {
    id: nanoid(),
    userId,
    message,
    metadata: metadata || {},
    createdAt: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
  };

  try {
    const insertedId = await db.insertMessage(record);

    return res.status(201).json({
      id: insertedId,
      status: 'stored',
    });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to insert message');
    return res.status(500).json({ error: 'DatabaseInsertError' });
  }
});

// quick testing
app.get('/v1/messages', async (req, res) => {
  const { userId } = req.query;
  try {
    const items = await db.findMessages(userId || null);
    res.json({ items });
  } catch (error) {
    req.log.error({ err: error }, 'Failed to read messages');
    res.status(500).json({ error: 'DatabaseReadError' });
  }
});

// Centralized error handler
app.use((err, req, res, _next) => {
  if (req && req.log) {
    req.log.error({ err }, 'Unhandled error');
  } else {
    logger.error({ err }, 'Unhandled error');
  }
  res.status(500).json({ error: 'InternalServerError' });
});

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down');
  try {
    await db.close();
  } catch (error) {
    logger.error({ err: error }, 'Error while closing DB pool');
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Ingest service listening');
});
