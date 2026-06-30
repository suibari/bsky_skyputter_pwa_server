import { type Request } from 'express';

// Bearerトークンを取り出す
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

// AT Protocol の getSession でアクセストークンを検証し、DIDを返す
// 検証失敗時は null を返す
export async function verifyAccessJwt(accessJwt: string): Promise<string | null> {
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
