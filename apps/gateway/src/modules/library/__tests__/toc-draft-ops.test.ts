import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  TOC_DRAFT_ADD_ENTRY_TOOL,
  TOC_DRAFT_MAX_OPS_PER_SESSION,
  TOC_DRAFT_REMOVE_ENTRY_TOOL,
  TOC_DRAFT_UPDATE_ENTRY_TOOL,
  baselineEntryId,
  initTocDraftSession,
  isTocDraftOpCall,
  isTocDraftSessionRegistered,
  peekTocDraftSession,
  registerTocDraftSession,
  takeTocDraftSession,
  tocDraftOpTools,
  validateMergedEntries,
  TocDraftAddEntryTool,
  TocDraftRemoveEntryTool,
  TocDraftUpdateEntryTool,
} from '../application/pdf-import/toc-draft-ops.js';

/**
 * CMD-LINGUA-P3.5 增量工具单测（全手写 synthetic，无私人教材与课文）。
 * 失败断言只看原因码 + 位点 hint，永不断言标题原文（防泄漏回归）。
 */
function ctx(sessionId: string): { userId: string; sessionId: string } {
  return { userId: 'u1', sessionId };
}

function seedBaseline(sessionId: string): void {
  registerTocDraftSession(sessionId);
  initTocDraftSession(sessionId, [
    { title: '第1課 はじめまして', printedPage: 3, level: 1, kind: 'lesson' },
    { title: '第2課 さんぽ', printedPage: 7, level: 1, kind: 'lesson' },
  ]);
}

function addTool(): TocDraftAddEntryTool {
  return tocDraftOpTools[0] as TocDraftAddEntryTool;
}

function updateTool(): TocDraftUpdateEntryTool {
  return tocDraftOpTools[1] as TocDraftUpdateEntryTool;
}

function removeTool(): TocDraftRemoveEntryTool {
  return tocDraftOpTools[2] as TocDraftRemoveEntryTool;
}

describe('P3.5 工具元信息与命名', () => {
  it('三工具名/位置/权限（WRITE 会话暂存写）', () => {
    expect(addTool().name).toBe(TOC_DRAFT_ADD_ENTRY_TOOL);
    expect(updateTool().name).toBe(TOC_DRAFT_UPDATE_ENTRY_TOOL);
    expect(removeTool().name).toBe(TOC_DRAFT_REMOVE_ENTRY_TOOL);
    for (const tool of tocDraftOpTools) {
      expect(tool.location).toBe('SERVER');
      expect(tool.permission).toBe('WRITE');
    }
    expect(isTocDraftOpCall('toc_draft_add_entry')).toBe(true);
    expect(isTocDraftOpCall('toc.draft.update.entry')).toBe(true);
    expect(isTocDraftOpCall('toc_draft_replace_all')).toBe(false);
    expect(isTocDraftOpCall('other_tool')).toBe(false);
    expect(baselineEntryId(0)).toBe('b0');
    expect(baselineEntryId(12)).toBe('b12');
  });
});

describe('P3.5 add_entry', () => {
  it('合法新增：定位插入 + 返回 entryId + 单调守门', async () => {
    const sid = `p35-add-${Date.now()}`;
    seedBaseline(sid);
    const res = await addTool().execute(
      { title: '復習A まとめ', printedPage: 5, level: 1, kind: 'lesson', reason: '图片可见漏项', afterEntryId: 'b0' },
      ctx(sid)
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.accepted).toBe(true);
    expect(res.value.entryId).toBe('n0');
    const taken = takeTocDraftSession(sid);
    expect(taken?.merged.map((e) => e.title)).toEqual(['第1課 はじめまして', '復習A まとめ', '第2課 さんぽ']);
    expect(taken?.merged[1]).toMatchObject({ entryId: 'n0', change: 'add', confidence: 'medium' });
    expect(taken?.diff).toHaveLength(3);
    // add 无改前：before 必须为 null，after 为新增快照
    expect(taken?.diff.find((d) => d.entryId === 'n0')).toMatchObject({
      change: 'add',
      before: null,
      after: { title: '復習A まとめ', printedPage: 5 },
    });
  });

  it('afterEntryId 定位 + 页码倒退拒绝（原子：状态不变）', async () => {
    const sid = `p35-addpos-${Date.now()}`;
    seedBaseline(sid);
    const okRes = await addTool().execute(
      { title: '付録 資料', printedPage: 30, level: 2, kind: 'section', reason: '末尾附录', afterEntryId: 'b1' },
      ctx(sid)
    );
    expect(isOk(okRes)).toBe(true);
    const bad = await addTool().execute(
      { title: '第0課 序', printedPage: 1, level: 1, kind: 'lesson', reason: 'x', afterEntryId: 'b1' },
      ctx(sid)
    );
    expect(isOk(bad)).toBe(false);
    if (isOk(bad)) return;
    expect(bad.error.code).toBe('E_TOC_DRAFT_ORDER');
    // 失败零副作用：顺序与计数保持上次成功态
    const taken = takeTocDraftSession(sid);
    expect(taken?.merged.map((e) => e.entryId)).toEqual(['b0', 'b1', 'n0']);
    expect(taken?.calls).toBe(2);
    expect(taken?.successes).toBe(1);
  });

  it('无语义标题/坏页码/缺 reason 拒绝且无原文回显', async () => {
    const sid = `p35-addneg-${Date.now()}`;
    seedBaseline(sid);
    const badTitle = await addTool().execute(
      { title: '··· 15', printedPage: 9, level: 1, kind: 'lesson', reason: 'x' },
      ctx(sid)
    );
    expect(isOk(badTitle)).toBe(false);
    if (isOk(badTitle)) return;
    expect(badTitle.error.code).toBe('E_TOC_DRAFT_TITLE');
    expect(badTitle.error.userMessage).not.toContain('···');
    const badPage = await addTool().execute(
      { title: '第9課 あ', printedPage: 0, level: 1, kind: 'lesson', reason: 'x' },
      ctx(sid)
    );
    expect(isOk(badPage)).toBe(false);
    if (isOk(badPage)) return;
    expect(badPage.error.code).toBe('E_TOC_DRAFT_PAGE');
  });
});

describe('P3.5 update/remove + expectedBefore', () => {
  it('update 命中：expectedBefore 全对才改，base 留原文', async () => {
    const sid = `p35-upd-${Date.now()}`;
    seedBaseline(sid);
    const res = await updateTool().execute(
      {
        entryId: 'b1',
        expectedBefore: { title: '第2課 さんぽ', printedPage: 7 },
        patch: { title: '第2課 おさんぽ', confidence: 'high' },
        reason: '图片核对错字',
      },
      ctx(sid)
    );
    expect(isOk(res)).toBe(true);
    const taken = takeTocDraftSession(sid);
    const row = taken?.diff.find((d) => d.entryId === 'b1');
    expect(row).toMatchObject({ change: 'update', needsReview: false });
    expect(row?.before).toMatchObject({ title: '第2課 さんぽ', printedPage: 7 });
    expect(row?.after).toMatchObject({ title: '第2課 おさんぽ', confidence: 'high' });
  });

  it('expectedBefore 失配/空对象/未知 id → stale/args，状态不动', async () => {
    const sid = `p35-stale-${Date.now()}`;
    seedBaseline(sid);
    const mismatch = await updateTool().execute(
      { entryId: 'b0', expectedBefore: { printedPage: 99 }, patch: { title: '第1課 X' }, reason: 'x' },
      ctx(sid)
    );
    expect(isOk(mismatch)).toBe(false);
    if (isOk(mismatch)) return;
    expect(mismatch.error.code).toBe('E_TOC_DRAFT_STALE');
    const unknown = await removeTool().execute(
      { entryId: 'b9', expectedBefore: { title: 'y' }, reason: 'x' },
      ctx(sid)
    );
    expect(isOk(unknown)).toBe(false);
    if (isOk(unknown)) return;
    expect(unknown.error.code).toBe('E_TOC_DRAFT_STALE');
    const taken = takeTocDraftSession(sid);
    expect(taken?.diff.filter((d) => d.change !== 'keep')).toEqual([]);
    expect(taken?.merged).toHaveLength(2);
  });

  it('remove 保留快照；重复删/删后改 → stale', async () => {
    const sid = `p35-rm-${Date.now()}`;
    seedBaseline(sid);
    const rm = await removeTool().execute(
      { entryId: 'b0', expectedBefore: { title: '第1課 はじめまして' }, reason: '正文确认非目录行' },
      ctx(sid)
    );
    expect(isOk(rm)).toBe(true);
    const rmAgain = await removeTool().execute(
      { entryId: 'b0', expectedBefore: { title: '第1課 はじめまして' }, reason: 'x' },
      ctx(sid)
    );
    expect(isOk(rmAgain)).toBe(false);
    const updGone = await updateTool().execute(
      { entryId: 'b0', expectedBefore: { title: '第1課 はじめまして' }, patch: { title: 'X' }, reason: 'x' },
      ctx(sid)
    );
    expect(isOk(updGone)).toBe(false);
    const taken = takeTocDraftSession(sid);
    expect(taken?.merged.map((e) => e.entryId)).toEqual(['b1']);
    const row = taken?.diff.find((d) => d.entryId === 'b0');
    expect(row?.change).toBe('remove');
    expect(row?.before).toMatchObject({ title: '第1課 はじめまして' });
    expect(row?.after).toBeNull();
  });

  it('needsReview 标记透传到 diff 与合并行', async () => {
    const sid = `p35-nr-${Date.now()}`;
    seedBaseline(sid);
    const res = await updateTool().execute(
      { entryId: 'b1', expectedBefore: { title: '第2課 さんぽ' }, patch: { needsReview: true }, reason: '页码模糊' },
      ctx(sid)
    );
    expect(isOk(res)).toBe(true);
    const taken = takeTocDraftSession(sid);
    expect(taken?.merged.find((e) => e.entryId === 'b1')?.needsReview).toBe(true);
    expect(taken?.diff.find((d) => d.entryId === 'b1')).toMatchObject({ change: 'update', needsReview: true });
  });
});

describe('P3.5 预算/隔离/终态门', () => {
  it('未登记会话三工具全拒；耗尽后拒绝；take 注销', async () => {
    const stranger = `p35-str-${Date.now()}`;
    for (const tool of tocDraftOpTools) {
      const r = await tool.execute({ entryId: 'b0', expectedBefore: { title: 'x' }, patch: { title: 'y' }, reason: 'x' }, ctx(stranger));
      expect(isOk(r)).toBe(false);
      if (isOk(r)) return;
      expect(r.error.code).toBe('E_TOC_DRAFT_SESSION');
    }
    const sid = `p35-ex-${Date.now()}`;
    registerTocDraftSession(sid);
    initTocDraftSession(sid, [{ title: '第1課 あ', printedPage: 1, level: 1, kind: 'lesson' }]);
    expect(isTocDraftSessionRegistered(sid)).toBe(true);
    for (let i = 0; i < TOC_DRAFT_MAX_OPS_PER_SESSION; i++) {
      await addTool().execute(
        { title: 'x', printedPage: 1, level: 1, kind: 'lesson', reason: 'x' },
        ctx(sid)
      );
    }
    const over = await addTool().execute(
      { title: '第9課 あ', printedPage: 9, level: 1, kind: 'lesson', reason: 'x' },
      ctx(sid)
    );
    expect(isOk(over)).toBe(false);
    if (isOk(over)) return;
    expect(over.error.code).toBe('E_TOC_DRAFT_EXHAUSTED');
    takeTocDraftSession(sid);
    expect(isTocDraftSessionRegistered(sid)).toBe(false);
    const afterTake = await addTool().execute(
      { title: '第9課 あ', printedPage: 9, level: 1, kind: 'lesson', reason: 'x' },
      ctx(sid)
    );
    expect(isOk(afterTake)).toBe(false);
  });

  it('validateMergedEntries：过少/坏标题/倒退拒绝，正常通过', () => {
    const good = [
      { entryId: 'b0', title: '第1課 あ', printedPage: 1, level: 1 as const, kind: 'lesson' as const, confidence: null, needsReview: false, change: 'keep' as const, base: null, reason: null },
      { entryId: 'b1', title: '第2課 い', printedPage: 2, level: 1 as const, kind: 'lesson' as const, confidence: null, needsReview: false, change: 'keep' as const, base: null, reason: null },
    ];
    expect(validateMergedEntries(good)).toEqual({ ok: true, reason: 'ok' });
    expect(validateMergedEntries(good.slice(0, 1)).reason).toBe('too-few');
    expect(validateMergedEntries([{ ...good[1]!, title: '123' }, good[0]!]).reason).toBe('bad-title');
    expect(validateMergedEntries([good[1]!, good[0]!]).reason).toBe('page-regress');
  });

  it('peek 只读不删；空会话 take 为 null', () => {
    const sid = `p35-peek-${Date.now()}`;
    registerTocDraftSession(sid);
    initTocDraftSession(sid, [{ title: '第1課 あ', printedPage: 1, level: 1, kind: 'lesson' }]);
    const peeked = peekTocDraftSession(sid);
    expect(peeked?.merged).toHaveLength(1);
    expect(peekTocDraftSession(sid)?.merged).toHaveLength(1);
    expect(takeTocDraftSession(`p35-ghost-${Date.now()}`)).toBeNull();
    takeTocDraftSession(sid);
  });
});
