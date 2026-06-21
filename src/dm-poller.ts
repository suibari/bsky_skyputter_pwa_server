import { sql } from './db.js';
import { sendPushToUser } from './webpush.js';

const POLL_INTERVAL_MS = 60_000;
const CHAT_API = 'https://api.bsky.chat/xrpc';
const BSKY_API = 'https://bsky.social/xrpc';

// 表示名キャッシュ（DID -> displayName || handle）
const displayNameCache = new Map<string, string>();

async function getDisplayName(did: string): Promise<string> {
  if (displayNameCache.has(did)) return displayNameCache.get(did)!;
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res.ok) return did;
    const data = (await res.json()) as { handle?: string; displayName?: string };
    const name = data.displayName || data.handle || did;
    displayNameCache.set(did, name);
    return name;
  } catch {
    return did;
  }
}

type RefreshResult = { accessJwt: string } | null;

async function refreshToken(refreshJwt: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${BSKY_API}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshJwt}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessJwt?: string };
    return data.accessJwt ? { accessJwt: data.accessJwt } : null;
  } catch {
    return null;
  }
}

type ConvoLastMessage = {
  $type?: string;
  text?: string;
  sender?: { did?: string };
  sentAt?: string;
};

type Convo = {
  id: string;
  unreadCount: number;
  lastMessage?: ConvoLastMessage;
};

async function listConvos(accessJwt: string): Promise<Convo[]> {
  try {
    const res = await fetch(`${CHAT_API}/chat.bsky.convo.listConvos?limit=100`, {
      headers: { Authorization: `Bearer ${accessJwt}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { convos?: Convo[] };
    return data.convos ?? [];
  } catch {
    return [];
  }
}

async function pollUser(user: {
  did: string;
  refresh_jwt: string;
  dm_unread: number;
}): Promise<void> {
  const refreshed = await refreshToken(user.refresh_jwt);
  if (!refreshed) return;

  const { accessJwt } = refreshed;

  // refreshしたaccessJwtをDBに更新
  await sql`
    UPDATE skyputter.users
    SET access_jwt = ${accessJwt}
    WHERE did = ${user.did}
  `;

  const convos = await listConvos(accessJwt);

  // 自分宛の未読がある会話を抽出
  const unreadConvos = convos.filter(
    (c) =>
      c.unreadCount > 0 &&
      c.lastMessage?.$type === 'chat.bsky.convo.defs#messageView' &&
      c.lastMessage.sender?.did &&
      c.lastMessage.sender.did !== user.did
  );

  const newTotal = unreadConvos.reduce((sum, c) => sum + c.unreadCount, 0);

  if (newTotal <= user.dm_unread) {
    // 未読が増えていなければ何もしない（既読後に減った場合も更新）
    if (newTotal !== user.dm_unread) {
      await sql`UPDATE skyputter.users SET dm_unread = ${newTotal} WHERE did = ${user.did}`;
    }
    return;
  }

  // 最も新しい未読会話を通知に使用
  const newest = unreadConvos.sort((a, b) => {
    const ta = a.lastMessage?.sentAt ?? '';
    const tb = b.lastMessage?.sentAt ?? '';
    return tb.localeCompare(ta);
  })[0];

  if (!newest?.lastMessage?.sender?.did) return;

  const senderName = await getDisplayName(newest.lastMessage.sender.did);
  const messageText = newest.lastMessage.text ?? '';

  await sendPushToUser(user.did, {
    title: `${senderName}からDMが届きました`,
    body: messageText,
    type: 'dm',
  });

  await sql`UPDATE skyputter.users SET dm_unread = ${newTotal} WHERE did = ${user.did}`;
}

async function pollAll(): Promise<void> {
  const users = await sql<{ did: string; refresh_jwt: string; dm_unread: number }[]>`
    SELECT did, refresh_jwt, dm_unread
    FROM skyputter.users
    WHERE refresh_jwt IS NOT NULL
  `;

  await Promise.allSettled(users.map(pollUser));
}

export async function initDmPoller(): Promise<void> {
  await pollAll();
  setInterval(() => {
    pollAll().catch((err) => console.error('[dm-poller] Error:', err));
  }, POLL_INTERVAL_MS);
  console.log('[dm-poller] Started. Polling every 60s.');
}
