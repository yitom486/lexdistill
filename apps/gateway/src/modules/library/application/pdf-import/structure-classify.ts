import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  logger,
} from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import { listKnownSkillIds } from '@study-studio/learner-core';
import {
  StructureClassSchema,
  type HeadingCandidate,
  type StructureClass,
} from '@study-studio/protocol';

/**
 * 标题结构分类（mini 模型分流任务）。
 * 分工：规则先抽候选标题（extractHeadingsFromMarkdown），mini 只做判选题；
 * 输出经联合枚举 + zod 校验 + 接地（文本必须等于输入候选、技能必须在允许集），
 * 对不上的一律丢弃计数，绝不臆造课，也不影响导入主流程（观测先行）。
 */

export interface AllowedSkill {
  id: string;
  title: string;
}

export interface ClassifiedStructure {
  classes: StructureClass[];
  /** 被丢弃数（文本对不上输入 / 技能不在允许集 / 字段非法） */
  dropped: number;
  model: string;
}

/** 模型返回 JSON 提取（花括号切片；与 enrich 同口径）。 */
export function parseStructureJson(text: string): unknown {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 接地校验（纯函数，可单测）：
 * - 文本必须等于某个输入候选（逐字；页码就近取该文本的页）；
 * - skillId 非空时必须在允许集，否则置空（保留条目，记 unmapped 由调用方统计覆盖率）。
 */
export function groundClassifications(
  items: unknown,
  candidates: HeadingCandidate[],
  allowedSkillIds: Set<string>
): { classes: StructureClass[]; dropped: number } {
  const classes: StructureClass[] = [];
  let dropped = 0;
  const byText = new Map<string, number>();
  for (const c of candidates) {
    if (!byText.has(c.text)) byText.set(c.text, c.page);
  }
  const list = Array.isArray(items) ? items : [];
  for (const raw of list) {
    const r = asRecord(raw);
    if (!r) {
      dropped += 1;
      continue;
    }
    const text = typeof r.text === 'string' ? r.text : '';
    const page = byText.get(text);
    if (!text || page === undefined) {
      dropped += 1;
      continue;
    }
    const kind = typeof r.kind === 'string' ? r.kind : '';
    if (kind !== 'lesson' && kind !== 'section' && kind !== 'toc' && kind !== 'noise') {
      dropped += 1;
      continue;
    }
    const lessonNo = typeof r.lessonNo === 'string' ? r.lessonNo.slice(0, 16) : null;
    const skillRaw = typeof r.skillId === 'string' ? r.skillId : null;
    const skillId = skillRaw && allowedSkillIds.has(skillRaw) ? skillRaw : null;
    const parsed = StructureClassSchema.safeParse({
      text,
      page,
      kind,
      lessonNo,
      skillId,
    });
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    classes.push(parsed.data);
  }
  return { classes, dropped };
}

export const STRUCTURE_CLASSIFY_SYSTEM_PROMPT = [
  '你是教材目录结构分类器。输入是候选标题行（OCR/规则抽取，可能含噪）。',
  '对每一行只做判选：lesson（课标题）/ section（节/小节）/ toc（目录行本身）/ noise（正文误入）。',
  '每行末尾【】内是版式观测信号（大N倍=相对字号，粗=加粗，居中，独立行，编号，H1-H6=标签角色），只作参考，不在信号里找课序号。',
  'lessonNo：课标题尽量给出课序号原文（如“3”“三”）；给不出为空。',
  'skillId：仅当标题明显对应允许技能之一才填，否则为空；绝不猜测、绝不编新 id。',
  '只返回 JSON：{"items": [{"text": "原文逐字", "kind": "...", "lessonNo": null, "skillId": null}]}。',
  'text 必须与输入逐字相等；输出除 JSON 外不加任何文字。',
].join('\n');

export interface ClassifyStructureInput {
  headings: HeadingCandidate[];
  allowedSkills: AllowedSkill[];
  /** 模型 id（空=网关默认）；effort 由前端按模型能力显式传入 */
  model?: string | undefined;
  effort?: string | undefined;
}

/** 版式特征 → 紧凑标签（无特征返回空串；只描述观测）。 */
export function featureTags(c: HeadingCandidate): string {
  const tags: string[] = [];
  if (typeof c.relSize === 'number' && Number.isFinite(c.relSize)) {
    tags.push(`大${Math.round(c.relSize * 100) / 100}倍`);
  }
  if (c.bold === true) tags.push('粗');
  if (c.centered === true) tags.push('居中');
  if (c.standalone === true) tags.push('独立行');
  if (c.hasNumbering === true) tags.push('编号');
  if (typeof c.structRole === 'string' && c.structRole) tags.push(c.structRole);
  return tags.length > 0 ? `｜${tags.join('·')}` : '';
}

/**
 * 跑一次分类（临时会话：ephemeral + tools 空 + 用完即关；中间态不落库）。
 * 无 adapter（离线）直接报错，不回退瞎编。
 */
export async function classifyStructure(
  adapter: AgentAdapter | undefined,
  input: ClassifyStructureInput
): Promise<Result<ClassifiedStructure, BusinessError>> {
  const candidates = (input.headings ?? []).filter(
    (h) => h && typeof h.text === 'string' && h.text.trim() && Number.isInteger(h.page) && h.page > 0
  );
  if (candidates.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', '没有可分类的标题候选', 'VALIDATION'));
  }
  if (!adapter) {
    return err(
      new BusinessError('E_CLASSIFY_NO_ADAPTER', 'AI 分类需要连接模型，请确认网关已连接后重试', 'AGENT_RUNTIME')
    );
  }
  const allowedIds = new Set([
    ...input.allowedSkills.map((s) => s.id),
    ...listKnownSkillIds(),
  ]);
  const skillLines = input.allowedSkills.map((s) => `- ${s.id}：${s.title}`).join('\n');
  const numbered = candidates.map((c, i) => `【${i + 1}｜p${c.page}${featureTags(c)}】${c.text}`).join('\n');
  const message =
    `允许技能（只能从中选）：\n${skillLines || '（无）'}\n\n` +
    `候选标题：\n${numbered}\n\n只返回 JSON。`;
  let session: AgentSession | null = null;
  try {
    const sessionRes = await adapter.createSession({
      sessionId: `classify-${Date.now()}`,
      userId: 'structure-classify',
      systemPrompt: STRUCTURE_CLASSIFY_SYSTEM_PROMPT,
      tools: [],
      ephemeral: true,
    });
    if (!isOk(sessionRes)) return err(sessionRes.error);
    session = sessionRes.value;
    const sendInput: { message: string; turnOptions?: { model?: string; effort?: string } } = {
      message,
    };
    if (input.model || input.effort) {
      sendInput.turnOptions = {
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
      };
    }
    let text = '';
    for await (const ev of session.send(sendInput)) {
      if (ev.type === 'TEXT_DELTA' && 'delta' in ev && typeof ev.delta === 'string') {
        text += ev.delta;
      } else if (ev.type === 'ERROR' && 'error' in ev && ev.error) {
        return err(
          ev.error instanceof BusinessError
            ? ev.error
            : new BusinessError('E_CLASSIFY_FAILED', '分类会话异常', 'AGENT_RUNTIME')
        );
      } else if (ev.type === 'COMPLETED') {
        if ('finalOutput' in ev && typeof ev.finalOutput === 'string') text = ev.finalOutput;
        break;
      }
    }
    const parsed = parseStructureJson(text);
    const items = asRecord(parsed)?.items;
    const { classes, dropped } = groundClassifications(items, candidates, allowedIds);
    const model = input.model ?? 'gateway-default';
    logger.debug('[classify] raw output', {
      model,
      chars: text.length,
      head: text.slice(0, 800),
      candidates: candidates.length,
      classes: classes.length,
      dropped,
    });
    if (classes.length === 0 && candidates.length > 0) {
      // 空结果是运营显著事件（用户只看到"0条"）：warn 让网关控制台可见，排查看上面的 debug。
      logger.warn('[classify] empty result (model returned no usable items)', {
        model,
        candidates: candidates.length,
        chars: text.length,
      });
    }
    return ok({ classes, dropped, model });
  } catch (e) {
    return err(
      translateToBusinessError(e, { category: 'AGENT_RUNTIME', action: 'classifyStructure' })
    );
  } finally {
    if (session) {
      try {
        await session.close();
      } catch {
        // 关闭失败不影响结果
      }
    }
  }
}
