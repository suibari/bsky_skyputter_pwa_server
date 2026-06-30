import { Router, type Request, type Response, type IRouter } from 'express';
import { sql } from '../db.js';
import { extractBearerToken, verifyAccessJwt } from '../auth-util.js';
import { setRepostNextPostEnabled } from '../jetstream.js';

// 通常の通知一覧取得はブラウザが @atproto/oauth-client-browser 経由で Bluesky へ直接問い合わせるため、
// サーバー側プロキシは不要。ここでは RepostNextPost（独自合成通知）のみを扱う。
const router: IRouter = Router();

// 認証ヘルパー: Bearer トークンを検証して DID を返す。失敗時は 401 を返して null。
async function requireUserDid(req: Request, res: Response): Promise<string | null> {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return userDid;
}

// GET /api/notifications/repost-next-post
// 未配信の RepostNextPost イベントを取得し、同時に消費（DELETE）する。
router.get('/repost-next-post', async (req: Request, res: Response) => {
  const userDid = await requireUserDid(req, res);
  if (!userDid) return;

  try {
    const rows = await sql`
      DELETE FROM skyputter.repost_next_post
      WHERE target_did = ${userDid} AND new_post_uri IS NOT NULL
      RETURNING reposter_did, new_post_uri, new_post_cid, created_at
    `;
    const events = rows.map((r) => ({
      uri: r.new_post_uri as string,
      cid: r.new_post_cid as string,
      reposterDid: r.reposter_did as string,
      createdAt: (r.created_at as Date).toISOString(),
    }));
    res.json({ events });
  } catch (err) {
    console.error('[notifications] Failed to fetch repost-next-post events:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/notifications/repost-next-post/settings
// RepostNextPost 機能の現在のON/OFFを返す（設定ページ初期表示用）。
router.get('/repost-next-post/settings', async (req: Request, res: Response) => {
  const userDid = await requireUserDid(req, res);
  if (!userDid) return;

  try {
    const rows = await sql`
      SELECT repost_next_post_enabled FROM skyputter.users WHERE did = ${userDid}
    `;
    const enabled = rows.length > 0 ? !!rows[0]!.repost_next_post_enabled : false;
    res.json({ enabled });
  } catch (err) {
    console.error('[notifications] Failed to get repost-next-post setting:', err);
    res.status(500).json({ error: 'Failed to get setting' });
  }
});

// POST /api/notifications/repost-next-post/settings
// RepostNextPost 機能のON/OFFを切り替える。
router.post('/repost-next-post/settings', async (req: Request, res: Response) => {
  const userDid = await requireUserDid(req, res);
  if (!userDid) return;

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }

  try {
    await sql`
      UPDATE skyputter.users SET repost_next_post_enabled = ${enabled} WHERE did = ${userDid}
    `;
    setRepostNextPostEnabled(userDid, enabled);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notifications] Failed to update repost-next-post setting:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

export default router;
