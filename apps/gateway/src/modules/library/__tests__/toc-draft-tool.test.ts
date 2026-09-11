import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  TOC_DRAFT_MAX_CALLS_PER_SESSION,
  TOC_DRAFT_MAX_ENTRIES,
  TOC_DRAFT_MIN_ENTRIES,
  TOC_DRAFT_TOOL_NAME,
  isTocDraftSessionRegistered,
  registerTocDraftSession,
  takeTocDraftToolResult,
  tocDraftReplaceAllTool,
  validateTocDraftToolInput,
} from '../application/pdf-import/toc-draft-tool.js';

/**
 * CMD-LINGUA-P3.4A 工具单测（全手写 synthetic，无私人教材与课文）。
 * 失败断言只看原因码 + 位点 hint，永不断言标题原文（防泄漏回归）。
 */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: '第1課 はじめまして', printedPage: 3, level: 1, kind: 'lesson', ...over };
}

function ctx(sessionId: string): { userId: string; sessionId: string } {
  return { userId: 'u1', sessionId };
}

describe('P3.4A 工具校验纯函数', () => {
  it('合法输入通过并归一化（去空白/默认 confidence/滤空 warnings）', () => {
    const checked = validateTocDraftToolInput({
      entries: [entry(), entry({ title: '第2課 さんぽ ', printedPage: 7, confidence: 'low' })],
      warnings: [' 存疑 ', '  '],
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.draft.entries).toEqual([
      { title: '第1課 はじめまして', printedPage: 3, level: 1, kind: 'lesson', confidence: 'medium' },
      { title: '第2課 さんぽ', printedPage: 7, level: 1, kind: 'lesson', confidence: 'low' },
    ]);
    expect(checked.draft.warnings).toEqual(['存疑']);
  });

  it('条数越界 → count（hint 只有长度，无原文）', () => {
    const one = validateTocDraftToolInput({ entries: [entry()], warnings: [] });
    expect(one).toMatchObject({ ok: false, reason: 'count' });
    if (one.ok) return;
    expect(one.hint).toBe('entries.length=1');
    const many = validateTocDraftToolInput({
      entries: Array.from({ length: TOC_DRAFT_MAX_ENTRIES + 1 }, (_, i) =>
        entry({ title: `第${i + 1}課 あ`, printedPage: i + 1 })
      ),
      warnings: [],
    });
    expect(many).toMatchObject({ ok: false, reason: 'count' });
    expect(TOC_DRAFT_MIN_ENTRIES).toBe(2);
  });

  it('空标题/无语义标题 → title（hint 只有位点）', () => {
    expect(validateTocDraftToolInput({ entries: [entry({ title: '   ' }), entry()], warnings: [] })).toMatchObject({
      ok: false,
      reason: 'title',
      hint: 'entries[0].title',
    });
    expect(
      validateTocDraftToolInput({ entries: [entry(), entry({ title: '··· 15' })], warnings: [] })
    ).toMatchObject({ ok: false, reason: 'title', hint: 'entries[1].title' });
  });

  it('页码非正整数/超界 → page；倒退 → order', () => {
    expect(
      validateTocDraftToolInput({ entries: [entry({ printedPage: 0 }), entry()], warnings: [] })
    ).toMatchObject({ ok: false, reason: 'page', hint: 'entries[0].printedPage' });
    expect(
      validateTocDraftToolInput({ entries: [entry(), entry({ title: '第2課 あ', printedPage: 2 })], warnings: [] })
    ).toMatchObject({ ok: false, reason: 'order', hint: 'entries[1].printedPage' });
    // 单调不减允许相等
    const equal = validateTocDraftToolInput({
      entries: [entry(), entry({ title: '第2課 あ', printedPage: 3 })],
      warnings: [],
    });
    expect(equal.ok).toBe(true);
  });

  it('level/kind 白名单外 → args（hint 无原文值）', () => {
    const bad = validateTocDraftToolInput({
      entries: [entry(), entry({ title: '第2課 あ', printedPage: 7, level: 3 })],
      warnings: [],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toBe('args');
    expect(bad.hint).toContain('entries[1].level');
  });

  it('形状非法 → args；错误消息永不含标题原文', () => {
    const bad = validateTocDraftToolInput({ entries: 'nope', warnings: [] });
    expect(bad).toMatchObject({ ok: false, reason: 'args' });
  });
});

describe('P3.4A 会话暂存语义', () => {
  it('成功暂存 + take 读取即删；双会话隔离', async () => {
    const s1 = `p34a-s1-${Date.now()}`;
    const s2 = `p34a-s2-${Date.now()}`;
    registerTocDraftSession(s1);
    expect(isTocDraftSessionRegistered(s1)).toBe(true);
    expect(isTocDraftSessionRegistered(s2)).toBe(false);
    const res = await tocDraftReplaceAllTool.execute(
      { entries: [entry(), entry({ title: '第2課 あ', printedPage: 7 })], warnings: ['w'] },
      ctx(s1)
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({ accepted: true, entries: 2, warnings: 1 });
    // 另一会话未调用 → 无暂存
    expect(takeTocDraftToolResult(s2)).toBeNull();
    const record = takeTocDraftToolResult(s1);
    expect(record?.draft?.entries.length).toBe(2);
    expect(record?.calls).toBe(1);
    expect(record?.successes).toBe(1);
    // 读取即删：二次 take 为空
    expect(takeTocDraftToolResult(s1)).toBeNull();
  });

  it('失败只记原因码不存草稿；第三次调用耗尽拒绝', async () => {
    const sid = `p34a-ex-${Date.now()}`;
    registerTocDraftSession(sid);
    const badInput = { entries: [entry({ printedPage: 0 }), entry()], warnings: [] };
    const r1 = await tocDraftReplaceAllTool.execute(badInput, ctx(sid));
    expect(isOk(r1)).toBe(false);
    if (isOk(r1)) return;
    expect(r1.error.code).toBe('E_TOC_DRAFT_PAGE');
    expect(r1.error.userMessage).not.toContain('第1課');
    const r2 = await tocDraftReplaceAllTool.execute(badInput, ctx(sid));
    expect(isOk(r2)).toBe(false);
    if (isOk(r2)) return;
    expect(r2.error.code).toBe('E_TOC_DRAFT_PAGE');
    const r3 = await tocDraftReplaceAllTool.execute(
      { entries: [entry(), entry({ title: '第2課 あ', printedPage: 7 })], warnings: [] },
      ctx(sid)
    );
    expect(isOk(r3)).toBe(false);
    if (isOk(r3)) return;
    expect(r3.error.code).toBe('E_TOC_DRAFT_EXHAUSTED');
    const record = takeTocDraftToolResult(sid);
    expect(record?.draft).toBeNull();
    expect(record?.calls).toBe(TOC_DRAFT_MAX_CALLS_PER_SESSION + 1);
    expect(record?.errorCodes).toEqual(['E_TOC_DRAFT_PAGE', 'E_TOC_DRAFT_PAGE', 'E_TOC_DRAFT_EXHAUSTED']);
  });

  it('P3.4B-ISO 未登记会话拒绝（预算不扣、暂存不建）；take 后注销', async () => {
    const sid = `p34a-iso-${Date.now()}`;
    const stranger = `p34a-stranger-${Date.now()}`;
    registerTocDraftSession(sid);
    const refused = await tocDraftReplaceAllTool.execute(
      { entries: [entry(), entry({ title: '第2課 あ', printedPage: 7 })], warnings: [] },
      ctx(stranger)
    );
    expect(isOk(refused)).toBe(false);
    if (isOk(refused)) return;
    expect(refused.error.code).toBe('E_TOC_DRAFT_SESSION');
    expect(refused.error.userMessage).not.toContain('第1課');
    // 陌生会话的调用不污染登记会话
    expect(takeTocDraftToolResult(sid)).toBeNull();
    // take 注销登记：之后再调同样拒绝
    registerTocDraftSession(stranger);
    await tocDraftReplaceAllTool.execute(
      { entries: [entry(), entry({ title: '第2課 あ', printedPage: 7 })], warnings: [] },
      ctx(stranger)
    );
    expect(takeTocDraftToolResult(stranger)?.draft?.entries.length).toBe(2);
    const afterTake = await tocDraftReplaceAllTool.execute(
      { entries: [entry(), entry({ title: '第2課 あ', printedPage: 7 })], warnings: [] },
      ctx(stranger)
    );
    expect(isOk(afterTake)).toBe(false);
    if (isOk(afterTake)) return;
    expect(afterTake.error.code).toBe('E_TOC_DRAFT_SESSION');
  });

  it('工具元信息：名/位置/权限/注册名一致', () => {
    expect(tocDraftReplaceAllTool.name).toBe(TOC_DRAFT_TOOL_NAME);
    expect(tocDraftReplaceAllTool.name).toBe('toc_draft_replace_all');
    expect(tocDraftReplaceAllTool.location).toBe('SERVER');
    expect(tocDraftReplaceAllTool.permission).toBe('READ');
  });
});
