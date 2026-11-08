'use strict';

const { createApp } = require('./app');
const db = require('./db');

const PORT = Number(process.env.PORT) || 3000;

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

async function initWithRetry(attempts = 5) {
  for (let i = 1; ; i++) {
    try {
      return await db.ready();
    } catch (err) {
      if (i >= attempts) throw err;
      console.error(`[db] init failed (attempt ${i}/${attempts}): ${err.message}; retrying`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  for (const name of ['API_TOKEN', 'OWNER_USER', 'OWNER_PASS']) {
    if (!process.env[name]) console.warn(`[config] ${name} is not set; protected routes will reject everyone`);
  }
  if (!process.env.WEBHOOK_URL) console.warn('[config] WEBHOOK_URL is not set; webhooks disabled');

  await initWithRetry();
  const server = createApp().listen(PORT, () => console.log(`lead-inbox listening on :${PORT}`));

  const shutdown = () => server.close(() => db.pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[startup] fatal:', err.message);
  process.exit(1);
});
