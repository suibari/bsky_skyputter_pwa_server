import 'dotenv/config';
import express from 'express';
import { initWebPush } from './webpush.js';
import { initJetstream } from './jetstream.js';
import loginRouter from './routes/login.js';
import authRouter from './routes/auth.js';
import pushRouter from './routes/push.js';
import notificationsRouter from './routes/notifications.js';
import draftsRouter from './routes/drafts.js';

const app = express();
app.use(express.json());

// CORS（複数オリジン対応。CLIENT_URLS にカンマ区切りで指定。* ワイルドカード使用可）
const allowedPatterns = (process.env.CLIENT_URLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  return allowedPatterns.some((pattern) => {
    if (!pattern.includes('*')) return pattern === origin;
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(origin);
  });
}

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ルーティング
app.use('/login', loginRouter);
app.use('/api/auth', authRouter);
app.use('/api/push', pushRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/drafts', draftsRouter);

// ヘルスチェック
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

async function main() {
  try {
    await Promise.all([initWebPush()]);
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
