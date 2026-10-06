import { Hono } from 'hono';
import { VocabularyScopeSchema, DailyPickRequestSchema } from '@study-studio/protocol';
import { isOk, BusinessError } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../../errors/http-error-handler.js';
import { pickDailyWords } from '../application/daily-pick.js';
import {
  installDictionaryPackage,
  listDictionaryPackages,
} from '../application/dictionary-packages.js';
import { buildCustomMeta, installYomitanFromBytes } from '../application/yomitan.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

// 词典安装任务表：进程级单例（随模块常驻，不随请求重建），G2 迁移时原样搬入本域。
const dictionaryInstallTasks = new Map<string, ReturnType<typeof installDictionaryPackage>>();

/** 词典域路由（G2：由 index.ts 链式注册迁移而来，行为不变）。 */
export function createDictionaryRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/api/vocabulary/:userId', async c => {
    const language = c.req.query('lang') ?? 'ja';
    const scope = VocabularyScopeSchema.safeParse({ ...c.req.query() });
    if (!['ja', 'en', 'ko'].includes(language) || !scope.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请选择有效的语种和教材章节', 'VALIDATION'));
    const result = await deps.repo.listVocabulary(c.req.param('userId'), language, scope.data);
    return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
  })
  .post('/api/vocabulary/:userId/daily-pick', async c => {
    try {
      const parsed = DailyPickRequestSchema.safeParse(await c.req.json());
      if (!parsed.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请选择有效的词库、数量与出词方式', 'VALIDATION'));
      const result = await pickDailyWords(deps.repo, c.req.param('userId'), parsed.data.lang, parsed.data);
      return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
    } catch (cause) { return formatBusinessErrorResponse(c, cause, 'dailyPick'); }
  })
  .post('/api/vocabulary/:userId/:vocabularyId/collect', async c => {
    try {
      const scope = VocabularyScopeSchema.safeParse(await c.req.json());
      if (!scope.success) return formatBusinessErrorResponse(c, new BusinessError('E_INVALID_INPUT', '请选择有效的教材章节', 'VALIDATION'));
      const result = await deps.repo.collectGlobalVocabulary(c.req.param('userId'), c.req.param('vocabularyId'), scope.data);
      return result.ok ? c.json(result.value) : formatBusinessErrorResponse(c, result.error);
    } catch (cause) { return formatBusinessErrorResponse(c, cause, 'collectVocabulary'); }
  })
  // 词典包默认不预装；客户端可先查询状态，再由用户显式触发一次下载与 SQLite 导入。
  .get('/api/dictionary/packages', (c) =>
    c.json({ packages: listDictionaryPackages(deps.repo.getRawDb()) })
  )
  .post('/api/dictionary/packages/:packageId/install', async (c) => {
    const packageId = c.req.param('packageId');
    let task = dictionaryInstallTasks.get(packageId);
    if (!task) {
      task = installDictionaryPackage(deps.repo.getRawDb(), packageId);
      dictionaryInstallTasks.set(packageId, task);
      void task.finally(() => dictionaryInstallTasks.delete(packageId));
    }

    const result = await task;
    if (isOk(result)) return c.json(result.value);
    return formatBusinessErrorResponse(c, result.error, 'dictionaryPackageInstall');
  })
  // 词典包配置（开关 / 排序权重），即时影响查词过滤与排序。
  .patch('/api/dictionary/packages/:packageId', async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as {
        enabled?: unknown;
        priority?: unknown;
      } | null;
      const patch: { enabled?: boolean; priority?: number } = {};
      if (body && typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (body && typeof body.priority === 'number') patch.priority = body.priority;
      const res = await deps.repo.updateDictionarySourceConfig(c.req.param('packageId'), patch);
      if (isOk(res)) return c.json(res.value);
      return formatBusinessErrorResponse(c, res.error, 'dictionaryPackageConfig');
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'dictionaryPackageConfig');
    }
  })
  // 自备 Yomitan 词典包安装（bank v3 zip）：multipart 文件直传 或 JSON { url } 下载。
  // 许可证由用户声明（未验证），安装行 license_note 如实标注，不伪装合规。
  .post('/api/dictionary/packages/custom', async (c) => {
    try {
      const contentType = c.req.header('content-type') ?? '';
      let zipBytes: Uint8Array | null = null;
      let language: string | undefined;
      let title: string | undefined;
      let sourceUrl: string | undefined;
      let licenseName: string | undefined;
      let attribution: string | undefined;
      if (contentType.includes('application/json')) {
        const body = (await c.req.json().catch(() => null)) as {
          url?: unknown;
          filePath?: unknown;
          language?: unknown;
          title?: unknown;
          licenseName?: unknown;
          attribution?: unknown;
        } | null;
        if (typeof body?.language === 'string') language = body.language;
        if (typeof body?.title === 'string') title = body.title;
        if (typeof body?.licenseName === 'string') licenseName = body.licenseName;
        if (typeof body?.attribution === 'string') attribution = body.attribution;
        if (typeof body?.filePath === 'string' && body.filePath) {
          // 大 zip 本地直读（同 multipart 百 MB 教训：不走 HTTP 拷贝）
          const { promises: fsp } = await import('node:fs');
          const { default: path } = await import('node:path');
          if (!path.isAbsolute(body.filePath) || path.extname(body.filePath).toLowerCase() !== '.zip') {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '只接受本机 .zip 绝对路径', 'VALIDATION')
            );
          }
          try {
            const stat = await fsp.stat(body.filePath);
            if (!stat.isFile() || stat.size === 0 || stat.size > 500 * 1024 * 1024) {
              return formatBusinessErrorResponse(
                c,
                new BusinessError('E_INVALID_INPUT', '本地文件无效或过大（上限 500MB）', 'VALIDATION')
              );
            }
            zipBytes = new Uint8Array(await fsp.readFile(body.filePath));
          } catch {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', '本地文件不存在或无权读取', 'VALIDATION')
            );
          }
        } else {
          if (typeof body?.url !== 'string' || !body.url) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', 'JSON 模式请提供 url 或 filePath', 'VALIDATION')
            );
          }
          sourceUrl = body.url;
          const response = await fetch(body.url);
          if (!response.ok) {
            return formatBusinessErrorResponse(
              c,
              new BusinessError('E_INVALID_INPUT', `词典下载失败（HTTP ${response.status}）`, 'NETWORK')
            );
          }
          zipBytes = new Uint8Array(await response.arrayBuffer());
        }
      } else {
        const body = await c.req.parseBody();
        const file = body['file'];
        if (!(file instanceof File)) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '请用 file 字段上传 .zip 词典包', 'VALIDATION')
          );
        }
        if (file.size === 0 || file.size > 500 * 1024 * 1024) {
          return formatBusinessErrorResponse(
            c,
            new BusinessError('E_INVALID_INPUT', '词典包过大（上限 500MB）', 'VALIDATION')
          );
        }
        const field = (k: string) => {
          const v = body[k];
          return typeof v === 'string' && v ? v : undefined;
        };
        language = field('language');
        title = field('title');
        licenseName = field('licenseName');
        attribution = field('attribution');
        zipBytes = new Uint8Array(await file.arrayBuffer());
      }
      if (language !== 'en' && language !== 'ja' && language !== 'ko') {
        return formatBusinessErrorResponse(
          c,
          new BusinessError('E_INVALID_INPUT', 'language 必须为 en/ja/ko', 'VALIDATION')
        );
      }
      const meta = buildCustomMeta(zipBytes, {
        language,
        ...(title ? { title } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(licenseName ? { licenseName } : {}),
        ...(attribution ? { attribution } : {}),
      });
      const result = await installYomitanFromBytes(deps.repo.getRawDb(), meta, zipBytes);
      if (isOk(result)) return c.json(result.value);
      return formatBusinessErrorResponse(c, result.error, 'dictionaryCustomInstall');
    } catch (e) {
      return formatBusinessErrorResponse(c, e, 'dictionaryCustomInstall');
    }
  })
  // 本地词典优先；仅在日语本地未命中时提供 OJAD 外链，不代理或抓取 OJAD。
  .get('/api/dictionary/:language', async (c) => {
    // P3-1 阅读上下文透传（可选 query param；Tool 名／权限不变）。
    const lookupDocumentId = c.req.query('documentId')?.trim() || undefined;
    const lookupQuote = c.req.query('quote')?.trim() || undefined;
    const result = await deps.server.toolRegistry.execute(
      'dictionary.lookup',
      {
        language: c.req.param('language'),
        query: c.req.query('q') ?? '',
        ...(lookupDocumentId ? { documentId: lookupDocumentId } : {}),
        ...(lookupQuote ? { quote: lookupQuote } : {}),
      },
      { userId: c.req.query('userId') || 'dictionary_http', sessionId: 'dictionary_http' }
    );
    if (!isOk(result)) {
      return formatBusinessErrorResponse(c, result.error, 'dictionaryLookup');
    }
    return c.json(result.value);
  })
  // 最近查词（画像“查过什么”信号 + 面板快捷入口）。
  .get('/api/dictionary/history/:userId', async (c) => {
    const lang = c.req.query('lang') || 'ja';
    if (lang !== 'ja' && lang !== 'en' && lang !== 'ko') {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '语种必须为 ja/en/ko', 'VALIDATION')
      );
    }
    const limitRaw = Number(c.req.query('limit') ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 20) : 10;
    const res = await deps.repo.getDictionarySearchHistory(c.req.param('userId'), lang, limit);
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 将公共词典资产收集为用户自己的 FSRS 生词卡；Web、桌面端与未来 Agent Tool 共用。
  .post('/api/vocabulary/:userId/entries/:entryId/collect', async (c) => {
    const result = await deps.repo.collectDictionaryEntry(
      c.req.param('userId'),
      c.req.param('entryId')
    );
    if (isOk(result)) return c.json(result.value);
    return formatBusinessErrorResponse(c, result.error, 'collectDictionaryEntry');
  })
  // 零基础单词表（开箱词包 + N5 核心，叠加用户已收/已学透态；空包返回空组，UI 显式空态）。
  .get('/api/wordlists/:userId', async (c) => {
    const res = await deps.repo.listWordlists(c.req.param('userId'), c.req.query('lang') || 'ja');
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 相遇词列表（按最近相遇倒序；仪表盘热力与复习选题消费）。
  .get('/api/encountered-terms/:userId', async (c) => {
    const limitRaw = Number(c.req.query('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const res = await deps.repo.listEncounteredTerms(
      c.req.param('userId'),
      c.req.query('lang') || 'ja',
      limit
    );
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 查词历史冷启动回填相遇词（幂等；重复调用只补审计不翻倍计数）。
  .post('/api/encountered-terms/:userId/backfill', async (c) => {
    const res = await deps.repo.backfillEncounteredTermsFromHistory(
      c.req.param('userId'),
      c.req.query('lang') || 'ja'
    );
    if (isOk(res)) return c.json(res.value);
    return formatBusinessErrorResponse(c, res.error);
  })
  // 词条例句（缓存优先；未命中且网关已连模型则生成入库，供讲透卡展示）。
  .get('/api/dictionary/examples', async (c) => {
    const meaningsRaw = c.req.query('meanings') || '';
    const res = await deps.repo.getTermExamples(
      {
        language: c.req.query('lang') || 'ja',
        headword: c.req.query('headword') || '',
        ...(c.req.query('reading') ? { reading: c.req.query('reading') as string } : {}),
        meanings: meaningsRaw
          .split('；')
          .map((m) => m.trim())
          .filter((m) => m)
          .slice(0, 4),
      },
      deps.server.agentAdapter
    );
    if (isOk(res)) return c.json({ examples: res.value });
    return formatBusinessErrorResponse(c, res.error, 'termExamples');
  })
  // 1. 学习者全景画像与打卡进度
;
}
