import { Hono } from 'hono';
import { isOk } from '@lexdistill/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { toDetachedArrayBuffer } from './response-bytes.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

/**
 * 用户媒体库读路由（内容寻址；哈希即权限——知道哈希才能取，不可枚举）。
 * 词典图片 / Anki 媒体共用此底座。
 */
export function createMediaRoutes(deps: GatewayDeps) {
  return new Hono().get('/api/media/:hash', async (c) => {
    try {
      const res = await deps.repo.readMediaFile(c.req.param('hash'));
      if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'mediaRead');
      return new Response(toDetachedArrayBuffer(res.value.bytes), {
        status: 200,
        headers: {
          'Content-Type': res.value.mediaType,
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'mediaRead');
    }
  });
}
