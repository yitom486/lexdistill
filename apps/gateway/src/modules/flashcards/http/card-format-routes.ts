import { Hono } from 'hono';
import { isOk } from '@study-studio/shared';
import type { AnkiCardFormat } from '@study-studio/flashcards';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { narrowSaveCardFormatInput } from '../persistence/card-formats.js';
import { narrowCardSourceEntry } from '../application/card-preview.js';
import { toDetachedArrayBuffer } from './response-bytes.js';
import type { GatewayDeps } from '../../../transport/http/gateway-deps.js';

/** 卡片模板域路由（呈现资产 CRUD + 预览；FSRS 调度仍走 review 域）。 */
export function createCardFormatRoutes(deps: GatewayDeps) {
  return (
    new Hono()
      .get('/api/flashcards/formats', async (c) => {
        const res = await deps.repo.listCardFormats();
        if (isOk(res)) return c.json({ formats: res.value });
        return formatBusinessErrorResponse(c, res.error, 'cardFormatsList');
      })
      // 保存模板（id 以路径为准；校验不通过拒绝写入并明说第一条问题）。
      .put('/api/flashcards/formats/:id', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
          const narrowed = narrowSaveCardFormatInput({ ...(body ?? {}), id: c.req.param('id') });
          if (!narrowed) {
            return formatBusinessErrorResponse(
              c,
              new Error('模板结构不正确：请检查名称、字段映射与正反面模板'),
              'cardFormatSave'
            );
          }
          const res = await deps.repo.saveCardFormat(narrowed);
          if (isOk(res)) return c.json({ format: res.value });
          return formatBusinessErrorResponse(c, res.error, 'cardFormatSave');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'cardFormatSave');
        }
      })
      // 恢复内置版本（仅内置 id；自定义模板拒绝并明说）。
      .post('/api/flashcards/formats/:id/reset', async (c) => {
        const res = await deps.repo.resetCardFormat(c.req.param('id'));
        if (isOk(res)) return c.json({ format: res.value });
        return formatBusinessErrorResponse(c, res.error, 'cardFormatReset');
      })
      // 预览（草稿只渲染不入库；与 flashcards.render Tool 同命令）。
      .post('/api/flashcards/preview', async (c) => {        try {
          const body = (await c.req.json().catch(() => null)) as {
            formatId?: unknown;
            inlineFormat?: unknown;
            entry?: unknown;
          } | null;
          const entry = narrowCardSourceEntry(body?.entry);
          if (!entry) {
            return formatBusinessErrorResponse(
              c,
              new Error('预览条目不正确：需要 headword 与 meanings'),
              'cardPreview'
            );
          }
          const res = await deps.repo.previewCardFormat({
            ...(typeof body?.formatId === 'string' ? { formatId: body.formatId } : {}),
            ...(body?.inlineFormat && typeof body.inlineFormat === 'object'
              ? { inlineFormat: body.inlineFormat as AnkiCardFormat }
              : {}),
            entry,
          });
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'cardPreview');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'cardPreview');
        }
      })
      // AnkiConnect 状态（开关 + 端点 + 本机 Anki 版本探测，不抛）。
      .get('/api/flashcards/anki/status', async (c) => {
        try {
          const settings = await deps.repo.getAnkiPushSettings();
          let ankiVersion: number | null = null;
          if (settings.enabled) {
            const { createAnkiClient, getAnkiVersion } = await import(
              '@study-studio/flashcards'
            );
            try {
              const probed = await getAnkiVersion(createAnkiClient(settings.endpoint));
              if (isOk(probed)) ankiVersion = probed.value;
            } catch {
              ankiVersion = null;
            }
          }
          return c.json({ ...settings, connected: ankiVersion !== null, ankiVersion });
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'ankiStatus');
        }
      })
      // AnkiConnect 开关/端点（默认关闭；endpoint 仅本机回环）。
      .put('/api/flashcards/anki/settings', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            enabled?: unknown;
            endpoint?: unknown;
          } | null;
          const res = await deps.repo.saveAnkiPushSettings({
            ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
            ...(typeof body?.endpoint === 'string' ? { endpoint: body.endpoint } : {}),
          });
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'ankiSettings');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'ankiSettings');
        }
      })
      // 推送生词卡到本机 Anki（与 flashcards.anki_push Tool 同命令；TTS 凭证随请求来、用完即弃）。
      .post('/api/flashcards/anki/push', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            userId?: unknown;
            cardId?: unknown;
            formatId?: unknown;
            deckName?: unknown;
            tts?: unknown;
          } | null;
          if (typeof body?.cardId !== 'string' || !body.cardId) {
            return formatBusinessErrorResponse(
              c,
              new Error('缺少生词卡 id，请先加入生词本再推送'),
              'ankiPush'
            );
          }
          const tts = narrowAnkiPushTts(body?.tts);
          const res = await deps.repo.pushCardToAnki({
            userId: typeof body?.userId === 'string' && body.userId ? body.userId : 'default_user',
            cardId: body.cardId,
            ...(typeof body?.formatId === 'string' ? { formatId: body.formatId } : {}),
            ...(typeof body?.deckName === 'string' ? { deckName: body.deckName } : {}),
            ...(tts ? { tts } : {}),
          });
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'ankiPush');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'ankiPush');
        }
      })
      // .apkg 分析（只读：牌组/笔记计数 + 模板草稿 + 映射推测 + 兼容性；不写库）。
      .post('/api/flashcards/apkg/analyze', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as { filePath?: unknown } | null;
          if (typeof body?.filePath !== 'string' || !body.filePath) {
            return formatBusinessErrorResponse(c, new Error('请提供本机 .apkg 绝对路径'), 'apkgAnalyze');
          }
          const { readApkgFileBytes, analyzeApkg } = await import('../application/apkg-import.js');
          const bytes = await readApkgFileBytes(body.filePath);
          if (!isOk(bytes)) return formatBusinessErrorResponse(c, bytes.error, 'apkgAnalyze');
          const label = body.filePath.split(/[\\/]/).pop() ?? 'package.apkg';
          const res = await analyzeApkg(bytes.value, label);
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'apkgAnalyze');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'apkgAnalyze');
        }
      })
      // .apkg 笔记搬家（笔记 → FSRS 卡；进度一律 NEW；去重；媒体只计数）。
      .post('/api/flashcards/apkg/import-notes', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            filePath?: unknown;
            userId?: unknown;
            language?: unknown;
            deckNames?: unknown;
            maxNotes?: unknown;
          } | null;
          if (typeof body?.filePath !== 'string' || !body.filePath) {
            return formatBusinessErrorResponse(c, new Error('请提供本机 .apkg 绝对路径'), 'apkgImport');
          }
          if (body?.language !== 'ja' && body?.language !== 'en' && body?.language !== 'ko') {
            return formatBusinessErrorResponse(
              c,
              new Error('导入语种须为 ja/en/ko（决定卡片归属，不可猜）'),
              'apkgImport'
            );
          }
          const { readApkgFileBytes } = await import('../application/apkg-import.js');
          const bytes = await readApkgFileBytes(body.filePath);
          if (!isOk(bytes)) return formatBusinessErrorResponse(c, bytes.error, 'apkgImport');
          const deckNames =
            Array.isArray(body?.deckNames) &&
            body.deckNames.every((d): d is string => typeof d === 'string')
              ? (body.deckNames as string[])
              : undefined;
          const res = await deps.repo.importApkgNotes(bytes.value, {
            userId: typeof body?.userId === 'string' && body.userId ? body.userId : 'default_user',
            language: body.language,
            ...(deckNames ? { deckNames } : {}),
            ...(typeof body?.maxNotes === 'number' ? { maxNotes: Math.floor(body.maxNotes) } : {}),
          });
          if (isOk(res)) return c.json(res.value);
          return formatBusinessErrorResponse(c, res.error, 'apkgImport');
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'apkgImport');
        }
      })
      // .apkg 导出（自研卡 → Anki 包；移动端同步通道；二进制下载）。
      .post('/api/flashcards/apkg/export', async (c) => {
        try {
          const body = (await c.req.json().catch(() => null)) as {
            userId?: unknown;
            language?: unknown;
            deckName?: unknown;
            formatId?: unknown;
            maxCards?: unknown;
          } | null;
          if (
            body?.language !== undefined &&
            body.language !== 'ja' &&
            body.language !== 'en' &&
            body.language !== 'ko'
          ) {
            return formatBusinessErrorResponse(
              c,
              new Error('导出语种须为 ja/en/ko（决定卡片范围，不可猜）'),
              'apkgExport'
            );
          }
          const res = await deps.repo.exportApkgFile({
            userId: typeof body?.userId === 'string' && body.userId ? body.userId : 'default_user',
            ...(body?.language === 'ja' || body?.language === 'en' || body?.language === 'ko'
              ? { language: body.language }
              : {}),
            ...(typeof body?.deckName === 'string' && body.deckName
              ? { deckName: body.deckName.slice(0, 80) }
              : {}),
            ...(typeof body?.formatId === 'string' ? { formatId: body.formatId } : {}),
            ...(typeof body?.maxCards === 'number' ? { maxCards: Math.floor(body.maxCards) } : {}),
          });
          if (!isOk(res)) return formatBusinessErrorResponse(c, res.error, 'apkgExport');
          const filename = res.value.filename;
          return new Response(toDetachedArrayBuffer(res.value.bytes), {
            status: 200,
            headers: {
              'Content-Type': 'application/zip',
              'Content-Disposition': `attachment; filename="cards.apkg"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            },
          });
        } catch (e) {
          return formatBusinessErrorResponse(c, e, 'apkgExport');
        }
      })
  );
}

/** 推送 TTS 凭证收窄（provider 必填；其余缺省；Key 只存本次调用内存）。 */
function narrowAnkiPushTts(input: unknown):
  | {
      provider: string;
      baseUrl?: string;
      region?: string;
      apiKey?: string;
      voice?: string;
      model?: string;
      rate?: number;
      gender?: 'FEMALE' | 'MALE';
    }
  | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const v = input as Record<string, unknown>;
  if (typeof v['provider'] !== 'string' || !v['provider']) return undefined;
  const out: {
    provider: string;
    baseUrl?: string;
    region?: string;
    apiKey?: string;
    voice?: string;
    model?: string;
    rate?: number;
    gender?: 'FEMALE' | 'MALE';
  } = { provider: v['provider'] };
  for (const key of ['baseUrl', 'region', 'apiKey', 'voice', 'model'] as const) {
    if (typeof v[key] === 'string' && v[key]) out[key] = v[key] as string;
  }
  if (typeof v['rate'] === 'number') out.rate = v['rate'];
  if (v['gender'] === 'FEMALE' || v['gender'] === 'MALE') out.gender = v['gender'];
  return out;
}
