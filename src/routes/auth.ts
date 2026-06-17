import { Router, type Request, type Response, type IRouter } from 'express';
import { upsertUser } from './login.js';

const router: IRouter = Router();

// POST /api/auth/register
// ブラウザ側 OAuth ログイン完了後に PWA から呼ばれ、Jetstream 監視対象に追加する
router.post('/register', async (req: Request, res: Response) => {
  const { did, handle } = req.body as { did?: string; handle?: string };
  if (!did || !handle) {
    res.status(400).json({ error: 'did and handle are required' });
    return;
  }

  try {
    await upsertUser(did, handle);
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] register failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
