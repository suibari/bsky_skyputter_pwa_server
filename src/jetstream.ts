import { WebSocket } from 'ws';
import { sql } from './db.js';
import { sendPushToUser, type PushPayload } from './webpush.js';

// ハンドル名キャッシュ（DID -> handle）
const handleCache = new Map<string, string>();

// 登録済みユーザー一覧のキャッシュ（DID -> Set<投稿URI prefix>）
// 通知判定のたびにDBを叩かないようにメモリに持つ
let registeredDids = new Set<string>();

// 起動時にDBからDID一覧を読み込む
export async function reloadRegisteredUsers(): Promise<void> {
  const rows = await sql`SELECT did FROM skyputter.users`;
  registeredDids = new Set(rows.map((r) => r.did as string));
  console.log(`[jetstream] Loaded ${registeredDids.size} registered user(s).`);
}

// ユーザー追加時に単一DIDを追加（全件リロード不要）
export function addRegisteredUser(did: string): void {
  registeredDids.add(did);
}

// ハンドル名取得（キャッシュ付き）
async function getHandle(did: string): Promise<string> {
  if (handleCache.has(did)) return handleCache.get(did)!;
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (!res.ok) return did;
    const data = (await res.json()) as { handle?: string };
    const handle = data.handle ?? did;
    handleCache.set(did, handle);
    return handle;
  } catch {
    return did;
  }
}

// Jetstreamイベントの型（最小限）
type JetstreamEvent = {
  did: string; // 送信者DID
  commit?: {
    collection: string;
    record?: Record<string, unknown>;
  };
};

// 通知判定・Push送信
// getHandle() は registeredDids.has() で対象ユーザーが確認されてから呼ぶ（不要なHTTPリクエスト削減）
async function handleEvent(event: JetstreamEvent): Promise<void> {
  const { did: senderDid, commit } = event;
  if (!commit?.record) return;

  const { collection, record } = commit;

  // いいね
  if (collection === 'app.bsky.feed.like') {
    const subjectUri = (record.subject as { uri?: string })?.uri;
    if (!subjectUri) return;
    const targetDid = extractDidFromUri(subjectUri);
    if (targetDid && registeredDids.has(targetDid)) {
      const senderHandle = await getHandle(senderDid);
      await sendPushToUser(targetDid, {
        title: 'いいね',
        body: `${senderHandle}さんがいいねしました`,
        type: 'like',
      });
    }
    return;
  }

  // リポスト
  if (collection === 'app.bsky.feed.repost') {
    const subjectUri = (record.subject as { uri?: string })?.uri;
    if (!subjectUri) return;
    const targetDid = extractDidFromUri(subjectUri);
    if (targetDid && registeredDids.has(targetDid)) {
      const senderHandle = await getHandle(senderDid);
      await sendPushToUser(targetDid, {
        title: 'リポスト',
        body: `${senderHandle}さんがリポストしました`,
        type: 'repost',
      });
    }
    return;
  }

  // フォロー
  if (collection === 'app.bsky.graph.follow') {
    const targetDid = record.subject as string | undefined;
    if (targetDid && registeredDids.has(targetDid)) {
      const senderHandle = await getHandle(senderDid);
      await sendPushToUser(targetDid, {
        title: 'フォロー',
        body: `${senderHandle}さんにフォローされました`,
        type: 'follow',
      });
    }
    return;
  }

  // 投稿系（リプライ・メンション・引用）
  if (collection === 'app.bsky.feed.post') {
    const postText = typeof record.text === 'string' ? record.text.trim() : '';
    const truncatedText = postText.length > 100 ? postText.slice(0, 100) + '…' : postText;

    // リプライ
    const replyParentUri = (
      record.reply as { parent?: { uri?: string } } | undefined
    )?.parent?.uri;
    if (replyParentUri) {
      const targetDid = extractDidFromUri(replyParentUri);
      if (targetDid && registeredDids.has(targetDid) && targetDid !== senderDid) {
        const senderHandle = await getHandle(senderDid);
        await sendPushToUser(targetDid, {
          title: `${senderHandle}さんが返信しました`,
          body: truncatedText || '（テキストなし）',
          type: 'reply',
        });
        return;
      }
    }

    // 引用
    const embed = record.embed as
      | { $type?: string; record?: { uri?: string } }
      | undefined;
    if (embed?.$type === 'app.bsky.embed.record' && embed.record?.uri) {
      const targetDid = extractDidFromUri(embed.record.uri);
      if (targetDid && registeredDids.has(targetDid) && targetDid !== senderDid) {
        const senderHandle = await getHandle(senderDid);
        await sendPushToUser(targetDid, {
          title: `${senderHandle}さんが引用しました`,
          body: truncatedText || '（テキストなし）',
          type: 'quote',
        });
        return;
      }
    }

    // メンション（facets内のmention）
    const facets = record.facets as
      | Array<{
          features?: Array<{ $type?: string; did?: string }>;
        }>
      | undefined;
    if (facets) {
      for (const facet of facets) {
        for (const feature of facet.features ?? []) {
          if (
            feature.$type === 'app.bsky.richtext.facet#mention' &&
            feature.did &&
            registeredDids.has(feature.did) &&
            feature.did !== senderDid
          ) {
            const senderHandle = await getHandle(senderDid);
            await sendPushToUser(feature.did, {
              title: `${senderHandle}さんにメンションされました`,
              body: truncatedText || '（テキストなし）',
              type: 'mention',
            });
          }
        }
      }
    }
  }
}

// at://did:plc:xxx/app.bsky.feed.post/yyy からDIDを抽出
function extractDidFromUri(uri: string): string | null {
  // at://did:plc:xxx/... または at://did:web:xxx/...
  const match = uri.match(/^at:\/\/(did:[^/]+)/);
  return match ? (match[1] ?? null) : null;
}

// JetstreamProxy接続
const COLLECTIONS = [
  'app.bsky.feed.like',
  'app.bsky.feed.repost',
  'app.bsky.feed.post',
  'app.bsky.graph.follow',
];

function buildWsUrl(): string {
  const base = process.env.JETSTREAM_URL ?? 'ws://localhost:8000';
  const params = COLLECTIONS.map((c) => `wantedCollections=${encodeURIComponent(c)}`).join('&');
  return `${base}?${params}&onlyCommit`;
}

export async function initJetstream(): Promise<void> {
  await reloadRegisteredUsers();
  connect();
}

function connect(): void {
  const url = buildWsUrl();
  console.log(`[jetstream] Connecting to ${url}`);
  const ws = new WebSocket(url);

  // バックプレッシャー用キュー（メッセージを1件ずつ順番に処理）
  let processing = false;
  const queue: JetstreamEvent[] = [];

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
      const event = queue.shift()!;
      await handleEvent(event).catch((err) => {
        console.error('[jetstream] Error handling event:', err);
      });
    }
    processing = false;
  }

  ws.on('open', () => {
    console.log('[jetstream] Connected.');
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString()) as JetstreamEvent;
      // キューが溢れた場合は古いイベントをドロップ
      if (queue.length >= 1000) {
        queue.shift();
        console.warn('[jetstream] Queue full, dropping oldest event.');
      }
      queue.push(event);
      processQueue();
    } catch {
      // JSON parse失敗は無視
    }
  });

  ws.on('close', () => {
    console.warn('[jetstream] Connection closed. Reconnecting in 5s...');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('[jetstream] WebSocket error:', err);
    // closeイベントが続けて発火するため、ここでは再接続しない
  });
}
