require('dotenv').config();
const pino = require('pino');
const { nanoid } = require('nanoid');
const db = require('./db');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '10', 10);
const INTERVAL_MS = parseInt(process.env.WORKER_INTERVAL_MS || '1000', 10);
const PARALLELISM = parseInt(process.env.WORKER_PARALLELISM || '4', 10);

function randomDelay(minMs = 50, maxMs = 500) {
  const span = Math.max(0, maxMs - minMs);
  return minMs + Math.floor(Math.random() * span);
}

function randomSuffix(length = 6) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function mockSentimentApi(text) {
  const delay = randomDelay();
  await new Promise((r) => setTimeout(r, delay));

  // ~20% failure rate
  const fail = Math.random() < 0.2;
  if (fail) {
    const err = new Error('Mock sentiment API failure');
    err.code = 'SENTIMENT_API_FAILURE';
    throw err;
  }

  //TODO: generate sentiment based on text not random
  return { sentiment: randomSuffix() };
}

async function mockSentimentApiWithRetry(text) {
    let attempt = 0;
    let lastErr;
    let retries = Number(process.env.RETRY_COUNT);
    let baseDelayMs = Number(process.env.RETRY_INTERVAL)
    while (attempt <= retries) {
        try {
            return await mockSentimentApi(text); // success: exit
        } catch (err) {
            lastErr = err;
            if (attempt === retries) break; // out of retries

            const expo = baseDelayMs * (2 ** attempt);
            const jitter = expo * (0.5 + Math.random()); // 0.5x–1.5x
            logger.warn({ attempt, retries, err }, 'Sentiment API failed, retrying with backoff');
            await new Promise(r => setTimeout(r, Math.round(jitter)));
        }
        attempt += 1;
    }

    // Exhausted retries
    logger.error({ attempts: attempt, err: lastErr }, 'Sentiment API failed after retries');
    throw lastErr;
}

let isShuttingDown = false;

async function processMessage(msg) {
  const correlationId = msg.id; // reuse message id
  try {
    logger.info({ correlationId, messageId: msg.id }, 'Processing message');
    const result = await mockSentimentApiWithRetry(msg.message);

    const newMessageRecord = {
      id: msg.id,
      userId: msg.userId,
      message: msg.message,
      metadata: {
          ...msg.metadata,
          augmented: true
      },
      createdAt: msg.createdAt,
      sentiment: result.sentiment,
    };
    await db.updateMessageSentiment(newMessageRecord);

    logger.info(
      { correlationId, messageId: msg.id, sentiment: result.sentiment },
      'Stored sentiment updated message'
    );
  } catch (error) {
    logger.warn({ correlationId, messageId: msg.id, err: error }, 'Processing failed');
  }
}

async function processBatch() {
  const items = await db.getUnprocessedMessages(BATCH_SIZE);
  if (!items.length) {
    logger.debug('No unprocessed messages');
    return 0;
  }

  const chunks = [];
  for (let i = 0; i < items.length; i += PARALLELISM) {
    chunks.push(items.slice(i, i + PARALLELISM));
  }
  let processed = 0;
  for (const chunk of chunks) {
    await Promise.allSettled(chunk.map((m) => processMessage(m)));
    processed += chunk.length;
  }
  return processed;
}

let tickInFlight = false;
async function tick() {
  if (tickInFlight || isShuttingDown) return;
  tickInFlight = true;
  try {
    const processed = await processBatch();
    if (processed > 0) {
      logger.info({ processed }, 'Batch processed');
    }
  } catch (error) {
    logger.error({ err: error }, 'Batch error');
  } finally {
    tickInFlight = false;
  }
}

async function start() {
  await db.init();
  logger.info({ batchSize: BATCH_SIZE, intervalMs: INTERVAL_MS, parallelism: PARALLELISM }, 'Worker started');
  const interval = setInterval(tick, INTERVAL_MS);

  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('Worker shutting down');
    clearInterval(interval);
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
}

start().catch((error) => {
  logger.error({ err: error }, 'Worker failed to start');
  process.exit(1);
}); 