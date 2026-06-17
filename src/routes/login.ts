import { Router, type Request, type Response, type IRouter } from 'express';

const router: IRouter = Router();

// POST /login/app-password
// App Password で認証する
router.post('/app-password', async (req: Request, res: Response) => {
  const identifier = (req.body as { identifier?: string }).identifier;
  const password = (req.body as { password?: string }).password;

  if (!identifier || !password) {
    res.status(400).json({ error: 'identifier and password are required' });
    return;
  }

  try {
    const loginRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (!loginRes.ok) throw new Error(`Login request failed: ${loginRes.status}`);
    const result = await loginRes.json() as { did: string; handle: string; accessJwt: string; refreshJwt?: string };

    const { did, handle, accessJwt, refreshJwt } = result;
    await upsertUser(did, handle);

    res.json({ did, handle, accessJwt, refreshJwt });
  } catch (err) {
    console.error('[oauth] App Password login failed:', err);
    res.status(401).json({ error: 'Login failed' });
  }
});

export async function upsertUser(did: string, handle: string): Promise<void> {
  const { sql } = await import('../db.js');
  const { addRegisteredUser } = await import('../jetstream.js');
  await sql`
    INSERT INTO skyputter.users (did, handle)
    VALUES (${did}, ${handle})
    ON CONFLICT (did) DO UPDATE
    SET handle = ${handle}, updated_at = NOW()
  `;
  addRegisteredUser(did);
  console.log(`[oauth] User upserted: ${handle} (${did})`);
}

export default router;
