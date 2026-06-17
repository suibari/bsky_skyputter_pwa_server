import { Router, type Request, type Response, type IRouter } from 'express';
import { sql } from '../db.js';
import { getVapidPublicKey } from '../webpush.js';

const router: IRouter = Router();

// GET /api/push/vapid-public-key
// クライアントがPush購読登録時に使うVAPID公開鍵を返す
router.get('/vapid-public-key', async (_req: Request, res: Response) => {
  try {
    const publicKey = await getVapidPublicKey();
    res.json({ publicKey });
  } catch (err) {
    console.error('[push] Failed to get VAPID public key:', err);
    res.status(500).json({ error: 'Failed to get VAPID public key' });
  }
});

// POST /api/push/subscribe
// Push購読情報をDBに登録する
// Authorizationヘッダ: Bearer <accessJwt>（Bluesky getSession で検証）
router.post('/subscribe', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  type SubBody = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const body = req.body as SubBody & { subscription?: SubBody };
  const { endpoint, keys } = body.subscription ?? body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: 'Invalid subscription object' });
    return;
  }

  try {
    await sql`
      INSERT INTO skyputter.push_subscriptions (user_did, endpoint, p256dh, auth)
      VALUES (${userDid}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
      ON CONFLICT (user_did, endpoint) DO NOTHING
    `;
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[push] Failed to save subscription:', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// DELETE /api/push/subscribe
// Push購読情報をDBから削除する
router.delete('/subscribe', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    res.status(400).json({ error: 'endpoint is required' });
    return;
  }

  try {
    await sql`
      DELETE FROM skyputter.push_subscriptions
      WHERE user_did = ${userDid} AND endpoint = ${endpoint}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error('[push] Failed to delete subscription:', err);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// Bearerトークンを取り出す
function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

// AT Protocol の getSession でアクセストークンを検証し、DIDを返す
// 検証失敗時は null を返す
async function verifyAccessJwt(accessJwt: string): Promise<string | null> {
  try {
    const res = await fetch('https://bsky.social/xrpc/com.atproto.server.getSession', {
      headers: { Authorization: `Bearer ${accessJwt}` },
    });
    if (!res.ok) return null;
    const { did } = await res.json() as { did: string };
    return typeof did === 'string' && did.startsWith('did:') ? did : null;
  } catch {
    return null;
  }
}

export default router;
