import { Router, type Request, type Response, type IRouter } from 'express';

const router: IRouter = Router();

// POST /api/notifications/seen
// Bluesky APIのapp.bsky.notification.updateSeenを呼び出して既読化する
// クライアントから直接Bluesky APIを叩くことも可能だが、
// アクセストークンをサーバー経由で使いたい場合のプロキシとして提供する
router.post('/seen', async (req: Request, res: Response) => {
  const accessToken = extractAccessToken(req);
  if (!accessToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { seenAt } = req.body as { seenAt?: string };
  const seenAtValue = seenAt ?? new Date().toISOString();

  try {
    const response = await fetch(
      'https://bsky.social/xrpc/app.bsky.notification.updateSeen',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ seenAt: seenAtValue }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('[notifications] updateSeen failed:', response.status, body);
      res.status(response.status).json({ error: 'Failed to update seen' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] Error calling updateSeen:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function extractAccessToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

export default router;
