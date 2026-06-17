import { Router, type Request, type Response, type IRouter } from 'express';
import { NodeOAuthClient, type NodeSavedState, type NodeSavedSession } from '@atproto/oauth-client-node';
import { sql } from '../db.js';
import { addRegisteredUser } from '../jetstream.js';

const router: IRouter = Router();

// AT Protocol OAuthクライアント（本番用）
let oauthClient: NodeOAuthClient | null = null;

// セッションストアはメモリ実装（本番はRedisやDBへの永続化を推奨）
// セッションに直接アクセスしてトークンを取得するためにMapを外部参照
const stateStoreMap = new Map<string, NodeSavedState>();
const sessionStoreMap = new Map<string, NodeSavedSession>();

export async function initOAuth(): Promise<void> {
  if (!process.env.ATPROTO_CLIENT_ID) {
    console.log('[oauth] ATPROTO_CLIENT_ID not set. OAuth disabled, App Password only.');
    return;
  }

  oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_id: process.env.ATPROTO_CLIENT_ID!,
      client_name: 'SkyPutter',
      redirect_uris: [process.env.ATPROTO_REDIRECT_URI!],
      scope: 'atproto transition:generic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    },
    stateStore: {
      async get(key: string) { return stateStoreMap.get(key); },
      async set(key: string, value: NodeSavedState) { stateStoreMap.set(key, value); },
      async del(key: string) { stateStoreMap.delete(key); },
    },
    sessionStore: {
      async get(key: string) { return sessionStoreMap.get(key); },
      async set(key: string, value: NodeSavedSession) { sessionStoreMap.set(key, value); },
      async del(key: string) { sessionStoreMap.delete(key); },
    },
  });
}

// GET /client-metadata.json
// AT Protocol OAuthのクライアントメタデータを返す
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

// GET /oauth/login?handle=xxx.bsky.social
// OAuthログインフローを開始する
router.get('/login', async (req: Request, res: Response) => {
  if (!oauthClient) {
    res.status(503).json({ error: 'OAuth not available. Use App Password login.' });
    return;
  }

  const handle = req.query.handle as string | undefined;
  if (!handle) {
    res.status(400).json({ error: 'handle is required' });
    return;
  }

  try {
    const url = await oauthClient.authorize(handle, { scope: 'atproto transition:generic' });
    res.redirect(url.toString());
  } catch (err) {
    console.error('[oauth] Failed to start OAuth flow:', err);
    res.status(500).json({ error: 'Failed to start OAuth flow' });
  }
});

// GET /oauth/callback
// OAuthコールバック。セッション確立後クライアントURLへリダイレクト
router.get('/callback', async (req: Request, res: Response) => {
  if (!oauthClient) {
    res.status(500).json({ error: 'OAuth not initialized' });
    return;
  }

  try {
    const params = new URLSearchParams(req.query as Record<string, string>);
    const { session } = await oauthClient.callback(params);

    const did = session.did;
    const res2 = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res2.ok) throw new Error(`Failed to fetch profile: ${res2.status}`);
    const profile = await res2.json() as { handle: string };
    const handle = profile.handle;

    await upsertUser(did, handle);

    const stored = sessionStoreMap.get(did);
    const accessJwt = stored !== undefined ? stored.tokenSet.access_token : '';

    // クライアントにDIDとアクセストークンをクエリパラメータで渡す
    // 本番ではよりセキュアな方法（セッションCookieなど）を検討すること
    const clientUrl = new URL(process.env.CLIENT_URL!);
    clientUrl.pathname = '/oauth/callback';
    clientUrl.searchParams.set('did', did);
    clientUrl.searchParams.set('accessJwt', accessJwt);
    res.redirect(clientUrl.toString());
  } catch (err) {
    console.error('[oauth] Callback failed:', err);
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// POST /oauth/app-password-login
// App Passwordで認証する（常時有効）
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
    console.error('[oauth] Dev login failed:', err);
    res.status(401).json({ error: 'Login failed' });
  }
});

// ユーザーをDBにUPSERTし、Jetstreamのフィルタ対象に追加する
async function upsertUser(did: string, handle: string): Promise<void> {
  await sql`
    INSERT INTO skyputter.users (did, handle)
    VALUES (${did}, ${handle})
    ON CONFLICT (did) DO UPDATE
    SET handle = ${handle}, updated_at = NOW()
  `;
  // 全件リロードせず単一DIDを追加
  addRegisteredUser(did);
  console.log(`[oauth] User upserted: ${handle} (${did})`);
}

export default router;
