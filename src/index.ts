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

// CORS（Cloudflare Pagesのオリジンのみ許可）
const allowedOrigin = process.env.CLIENT_URL ?? '';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', allowedOrigin);
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
