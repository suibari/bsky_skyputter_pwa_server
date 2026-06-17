import 'dotenv/config';
import express from 'express';
import { initWebPush } from './webpush.js';
import { initJetstream } from './jetstream.js';
import { initOAuth } from './routes/oauth.js';
import oauthRouter from './routes/oauth.js';
import pushRouter from './routes/push.js';
import notificationsRouter from './routes/notifications.js';

const app = express();
app.use(express.json());

// CORS（複数オリジン対応。CLIENT_URLS にカンマ区切りで指定、CLIENT_URL も後方互換で使用）
const allowedOrigins = new Set(
  (process.env.CLIENT_URLS ?? process.env.CLIENT_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (allowedOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ルーティング
app.use('/oauth', oauthRouter);
app.use('/api/push', pushRouter);
app.use('/api/notifications', notificationsRouter);

// ヘルスチェック
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

async function main() {
  try {
    await Promise.all([initWebPush(), initOAuth()]);
    await initJetstream();

    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, () => {
      console.log(`[server] SkyPutter server running on port ${port}`);
    });
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

main();
