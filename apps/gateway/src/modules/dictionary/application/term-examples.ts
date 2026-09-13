import type { AgentAdapter } from '@study-studio/agent-runtime';
import {
  BusinessError,
  err,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  generateId,
  nowIso,
  type Result,
} from '@study-studio/shared';
import { z } from 'zod';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { buildTermKey } from '../persistence/encountered-terms.js';

/**
 * 词条例句库（AI 按需生成 + 永久缓存，供讲透卡/练习复用）。
 * - 缓存是公共资产（按语种+归一键共享，不分用户；与词典内容同级）；
 * - 接地规则：例句必须原文包含该词（大小写不敏感），否则整条丢弃；
 * - 每词最多存 2 条；失败不缓存，前端静默降级（问 AI 兜底）；
 * - 无模型连接且缓存未命中 → E_EXAMPLES_NO_ADAPTER（与 enrich 同口径）。
 */

export const TermExampleSchema = z.object({
  sentence: z.string().trim().min(1).max(500),
  translation: z.string().trim().min(1).max(500),
});
export type TermExample = z.infer<typeof TermExampleSchema>;

export interface TermExampleItem extends TermExample {
  cached: boolean;
}

const LANG_NAME: Record<string, string> = { ja: '日语', en: '英语', ko: '韩语' };

const EXAMPLE_SYSTEM_PROMPT =
  '你是外语例句生成器。只返回 JSON，格式：{"examples": [{"sentence": "例句（必须原文包含目标词）", "translation": "中文翻译"}]}。' +
  '例句要短、具体、入门友好（日常场景），不要解释，不要 markdown。';

function normalizeExamples(raw: unknown, headword: string): TermExample[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { examples?: unknown }).examples;
  if (!Array.isArray(list)) return [];
  const needle = headword.trim().toLowerCase();
  const out: TermExample[] = [];
  for (const item of list) {
    const parsed = TermExampleSchema.safeParse(item);
    if (!parsed.success) continue;
    // 接地：例句必须包含目标词（防模型自由发挥写无关句子）
    if (!parsed.data.sentence.toLowerCase().includes(needle)) continue;
    if (out.some((e) => e.sentence === parsed.data.sentence)) continue;
    out.push(parsed.data);
    if (out.length >= 2) break;
  }
  return out;
}

export async function generateTermExamples(
  adapter: AgentAdapter | undefined,
  input: { language: string; headword: string; reading?: string; meanings: string[] }
): Promise<Result<TermExample[], BusinessError>> {
  const language = input.language;
  if (language !== 'ja' && language !== 'en' && language !== 'ko') {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  const headword = input.headword.trim().slice(0, 64);
  if (!headword) {
    return err(new BusinessError('E_INVALID_INPUT', 'headword 为空', 'VALIDATION'));
  }
  if (!adapter) {
    return err(
      new BusinessError('E_EXAMPLES_NO_ADAPTER', '例句生成需要连接模型，请确认网关已连接后重试', 'AGENT_RUNTIME')
    );
  }
  const sessionRes = await adapter.createSession({
    sessionId: `examples-${language}-${Date.now()}`,
    userId: 'term-examples',
    systemPrompt: EXAMPLE_SYSTEM_PROMPT,
    tools: [],
  });
  if (!isOk(sessionRes)) return err(sessionRes.error);
  const session = sessionRes.value;
  try {
    let text = '';
    for await (const ev of session.send({
      message:
        `目标词：${headword}` +
        (input.reading ? `（读音 ${input.reading}）` : '') +
        `\n释义：${input.meanings.slice(0, 4).join('；')}\n` +
        `请给 2 个${LANG_NAME[language]}入门例句，只返回 JSON。`,
    })) {
      if (ev.type === 'TEXT_DELTA') {
        text += ev.delta;
      } else if (ev.type === 'ERROR') {
        return err(ev.error);
      } else if (ev.type === 'COMPLETED') {
        if (ev.finalOutput) text = ev.finalOutput;
        break;
      }
    }
    let parsed: unknown = null;
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
    } catch {
      parsed = null;
    }
    const kept = normalizeExamples(parsed, headword);
    if (kept.length === 0) {
      return err(
        new BusinessError('E_EXAMPLES_PARSE', '模型返回无法解析出可用例句', 'AGENT_RUNTIME')
      );
    }
    logger.info('[term-examples] generated', { language, kept: kept.length });
    return ok(kept);
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'AGENT_RUNTIME', action: 'generateTermExamples' })
    );
  } finally {
    void session.close().catch(() => {});
  }
}

interface CachedExampleRow {
  sentence: string;
  translation: string;
}

/** 取例句（缓存优先；未命中且有模型则生成入库）。 */
export async function getTermExamples(
  deps: RepoDeps,
  adapter: AgentAdapter | undefined,
  input: { language: string; headword: string; reading?: string; meanings: string[] }
): Promise<Result<TermExampleItem[], BusinessError>> {
  const language = input.language;
  if (language !== 'ja' && language !== 'en' && language !== 'ko') {
    return err(new BusinessError('E_INVALID_INPUT', 'language 必须为 ja/en/ko', 'VALIDATION'));
  }
  const headword = input.headword.trim().slice(0, 64);
  if (!headword) {
    return err(new BusinessError('E_INVALID_INPUT', 'headword 为空', 'VALIDATION'));
  }
  const termKey = buildTermKey(headword, (input.reading ?? '').trim().slice(0, 64));
  try {
    const cached = deps.sqlite
      .query(
        `SELECT sentence AS sentence, translation AS translation FROM term_examples
         WHERE language = ? AND term_key = ? ORDER BY rowid LIMIT 2`
      )
      .all(language, termKey) as CachedExampleRow[];
    if (cached.length > 0) {
      return ok(cached.map((r) => ({ sentence: r.sentence, translation: r.translation, cached: true })));
    }
    const genRes = await generateTermExamples(adapter, {
      language,
      headword,
      ...(input.reading ? { reading: input.reading } : {}),
      meanings: input.meanings,
    });
    if (!isOk(genRes)) return err(genRes.error);
    const now = nowIso();
    const tx = deps.sqlite.transaction(() => {
      for (const e of genRes.value) {
        deps.sqlite
          .query(
            `INSERT OR IGNORE INTO term_examples
               (id, language, term_key, headword, sentence, translation, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'ai', ?)`
          )
          .run(generateId('tex'), language, termKey, headword, e.sentence, e.translation, now);
      }
    });
    tx();
    return ok(genRes.value.map((e) => ({ ...e, cached: false })));
  } catch (error) {
    return err(
      translateToBusinessError(error, { category: 'DATABASE', action: 'getTermExamples', entityId: termKey })
    );
  }
}
