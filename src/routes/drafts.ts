import { Router, type Request, type Response, type IRouter } from 'express';
import { sql } from '../db.js';
import { extractBearerToken, verifyAccessJwt } from '../auth-util.js';

const router: IRouter = Router();

// GET /api/drafts
// ログインユーザーの下書き一覧を返す（新しい順）
router.get('/', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const rows = await sql`
      SELECT id, text, created_at, updated_at
      FROM skyputter.drafts
      WHERE user_did = ${userDid}
      ORDER BY updated_at DESC
    `;
    const drafts = rows.map((r) => ({
      id: r.id as string,
      text: r.text as string,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    }));
    res.json({ drafts });
  } catch (err) {
    console.error('[drafts] Failed to fetch drafts:', err);
    res.status(500).json({ error: 'Failed to fetch drafts' });
  }
});

// GET /api/drafts/:id
// 指定IDの下書きを返す
router.get('/:id', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  try {
    const rows = await sql`
      SELECT id, text, created_at, updated_at
      FROM skyputter.drafts
      WHERE id = ${id} AND user_did = ${userDid}
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const r = rows[0]!;
    res.json({
      id: r.id as string,
      text: r.text as string,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    });
  } catch (err) {
    console.error('[drafts] Failed to fetch draft:', err);
    res.status(500).json({ error: 'Failed to fetch draft' });
  }
});

// PUT /api/drafts/:id
// 下書きを作成または更新する（upsert）
// body: { text: string, createdAt: string }
router.put('/:id', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  const { text, createdAt } = req.body as { text?: string; createdAt?: string };
  if (typeof text !== 'string' || typeof createdAt !== 'string') {
    res.status(400).json({ error: 'text and createdAt are required' });
    return;
  }

  try {
    await sql`
      INSERT INTO skyputter.drafts (id, user_did, text, created_at, updated_at)
      VALUES (${id}, ${userDid}, ${text}, ${createdAt}, NOW())
      ON CONFLICT (id) DO UPDATE
        SET text = EXCLUDED.text,
            updated_at = NOW()
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error('[drafts] Failed to save draft:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// DELETE /api/drafts/:id
// 下書きを削除する
router.delete('/:id', async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const userDid = token ? await verifyAccessJwt(token) : null;
  if (!userDid) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  try {
    await sql`
      DELETE FROM skyputter.drafts
      WHERE id = ${id} AND user_did = ${userDid}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error('[drafts] Failed to delete draft:', err);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

export default router;
