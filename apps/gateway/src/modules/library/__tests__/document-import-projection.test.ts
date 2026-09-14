import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { initSchema, listContentSegments } from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * P2-1 文本导入段投影（含恢复路径）。
 * - 成功路径：import done＋段落投影＋偏移有效；
 * - 失败恢复：删段表模拟投影失败→import 仍 done→missing 检出→
 *   建表恢复→显式重放成功→二次重放零重复。
 */
describe('document-import segment projection (P2-1)', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  const TEXT = '# 标题\n\n第一段正文内容足够长。\n\n第二段正文内容也足够长。';

  it('文本导入 done＋段投影＋偏移有效', async () => {
    const res = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'text',
      filename: 'note.txt',
      bytes: new TextEncoder().encode(TEXT),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.task.status).toBe('done');
    const segs = await listContentSegments(
      { sqlite: repo.getRawDb() },
      res.value.document.id
    );
    expect(isOk(segs)).toBe(true);
    if (!isOk(segs)) return;
    expect(segs.value.length).toBeGreaterThanOrEqual(2);
    // 偏移相对持久化 content 切片有效（文档入库只存前 2000 字，投影与之同源）。
    const stored = await repo.getDocumentById(res.value.document.id);
    expect(isOk(stored) && stored.value).toBeTruthy();
    if (!isOk(stored) || !stored.value) return;
    for (const s of segs.value) {
      if (s.startOffset === undefined || s.endOffset === undefined) continue;
      expect(stored.value.content.slice(s.startOffset, s.endOffset)).toBe(s.text);
    }
    const missing = await repo.findDocumentsMissingSegments('u1');
    expect(isOk(missing)).toBe(true);
    if (!isOk(missing)) return;
    expect(missing.value.find((m) => m.id === res.value.document.id)).toBe(undefined);
  });

  it('投影失败不挡导入；显式重放恢复且幂等', async () => {
    // 删段表：投影必败（saveCanonicalAst 不受影响）。
    repo.getRawDb().run('DROP TABLE content_segments');
    const res = await repo.importDocumentFile({
      userId: 'u1',
      kind: 'text',
      filename: 'note.txt',
      bytes: new TextEncoder().encode(TEXT),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.task.status).toBe('done');
    // 建表恢复（initSchema 幂等只补缺失）→重试信号检出。
    initSchema(repo.getRawDb());
    const missing = await repo.findDocumentsMissingSegments('u1');
    expect(isOk(missing)).toBe(true);
    if (!isOk(missing)) return;
    expect(missing.value.find((m) => m.id === res.value.document.id)?.sourceKind).toBe(
      'user_import'
    );
    const replay = await repo.reprojectDocumentSegments('u1', res.value.document.id);
    expect(isOk(replay)).toBe(true);
    if (!isOk(replay)) return;
    expect(replay.value.inserted).toBeGreaterThan(0);
    const segs = await listContentSegments(
      { sqlite: repo.getRawDb() },
      res.value.document.id
    );
    expect(isOk(segs) && segs.value.length).toBeTruthy();
    // 二次重放零重复。
    const again = await repo.reprojectDocumentSegments('u1', res.value.document.id);
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value).toEqual({ inserted: 0, skipped: replay.value.inserted + replay.value.skipped });
    const after = await repo.findDocumentsMissingSegments('u1');
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value.find((m) => m.id === res.value.document.id)).toBe(undefined);
  });
});
