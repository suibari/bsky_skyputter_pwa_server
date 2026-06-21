import webpush from 'web-push';
import { sql } from './db.js';

export type PushPayload = {
  title: string;
  body: string;
  type: 'like' | 'repost' | 'follow' | 'reply' | 'mention' | 'quote' | 'dm';
};

let cachedPublicKey: string | null = null;

export async function initWebPush(): Promise<void> {
  const rows = await sql`
    SELECT public_key, private_key FROM skyputter.vapid_keys LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error('VAPID keys not found in DB. Run the key generation step first.');
  }
  const row = rows[0]!;
  const { public_key, private_key } = row;
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT ?? 'admin@example.com'}`,
    public_key as string,
    private_key as string,
  );
  cachedPublicKey = public_key as string;
  console.log('[webpush] VAPID keys loaded.');
}

export async function getVapidPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  // initWebPush() 前に呼ばれた場合のフォールバック
  const rows = await sql`SELECT public_key FROM skyputter.vapid_keys LIMIT 1`;
  if (rows.length === 0) throw new Error('VAPID keys not found');
  cachedPublicKey = rows[0]!.public_key as string;
  return cachedPublicKey;
}

export async function sendPushToUser(userDid: string, payload: PushPayload): Promise<void> {
  const subscriptions = await sql`
    SELECT endpoint, p256dh, auth
    FROM skyputter.push_subscriptions
    WHERE user_did = ${userDid}
  `;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: {
            p256dh: sub.p256dh as string,
            auth: sub.auth as string,
          },
        },
        JSON.stringify(payload)
      );
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410) {
        // 購読が無効になっているため削除
        await sql`
          DELETE FROM skyputter.push_subscriptions WHERE endpoint = ${sub.endpoint}
        `;
        console.log(`[webpush] Removed expired subscription: ${sub.endpoint}`);
      } else {
        console.error(`[webpush] Failed to send push to ${userDid}:`, err);
      }
    }
  }
}
