import { Router, type IRouter } from 'express';

// 通知 API はブラウザが @atproto/oauth-client-browser 経由で Bluesky へ直接呼ぶため、
// サーバー側プロキシは不要。ルーターは後方互換のため空で残す。
const router: IRouter = Router();

export default router;
