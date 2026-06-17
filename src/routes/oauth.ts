import { Router, type Request, type Response, type IRouter } from 'express';

const router: IRouter = Router();

// GET /client-metadata.json
// AT Protocol OAuth クライアントメタデータ（ブラウザ側 OAuth クライアントが参照）
router.get('/client-metadata.json', (_req: Request, res: Response) => {
  res.json({
    client_id: process.env.ATPROTO_CLIENT_ID,
    client_name: 'SkyPutter',
    redirect_uris: [process.env.ATPROTO_REDIRECT_URI],
    scope: 'atproto transition:generic',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  });
});

// POST /oauth/app-password-login
// App Password で認証する（常時有効）
router.post('/app-password-login', async (req: Request, res: Response) => {
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
