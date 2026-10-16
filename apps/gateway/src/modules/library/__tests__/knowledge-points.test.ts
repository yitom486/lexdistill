import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import {
  LibraryKnowledgeSaveTool,
  LibraryKnowledgeSaveInputSchema,
} from '../tools/library-knowledge-tool.js';

/**
 * 目录挂载知识点（v30 knowledge_points）集成测试。
 * - 门面 round-trip：存→列→同键重存刷新（不增行）→分课隔离；
 * - 守卫：空 concept / 空 id / 非法 kind 拒绝；
 * - Tool：schema 拒绝非法输入；execute 在真仓储上落库。
 */
describe('knowledge-points（目录挂载蒸馏点）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('存→列→重存刷新：同键不增行，释义被覆盖', async () => {
    const first = await repo.saveKnowledgePoints({
      documentId: 'd_kp',
      lessonId: 'l1',
      points: [
        { concept: 'に vs で', kind: 'rule', explanationMd: '旧释义', sourceRefs: ['seg1'] },
        { concept: '食べる', kind: 'vocab_ref' },
      ],
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value).toEqual({ saved: 2, updated: 0 });

    const listed = await repo.listKnowledgePoints('d_kp', 'l1');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value).toHaveLength(2);
    expect(listed.value.find((p) => p.concept === 'に vs で')).toMatchObject({
      kind: 'rule',
      explanationMd: '旧释义',
      sourceRefs: ['seg1'],
    });
    // 悬空知识点：无 sourceRefs 即空数组，照常可学。
    expect(listed.value.find((p) => p.concept === '食べる')).toMatchObject({
      kind: 'vocab_ref',
      sourceRefs: [],
    });

    const again = await repo.saveKnowledgePoints({
      documentId: 'd_kp',
      lessonId: 'l1',
      points: [{ concept: 'に vs で', kind: 'rule', explanationMd: '新释义' }],
    });
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value).toEqual({ saved: 0, updated: 1 });

    const after = await repo.listKnowledgePoints('d_kp', 'l1');
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value).toHaveLength(2);
    expect(after.value.find((p) => p.concept === 'に vs で')?.explanationMd).toBe('新释义');
  });

  it('分课隔离；空课返回空数组；空 id 拒绝', async () => {
    expect(
      isOk(
        await repo.saveKnowledgePoints({
          documentId: 'd_kp',
          lessonId: 'l1',
          points: [{ concept: 'c1' }],
        })
      )
    ).toBe(true);
    const other = await repo.listKnowledgePoints('d_kp', 'l2');
    expect(isOk(other)).toBe(true);
    if (!isOk(other)) return;
    expect(other.value).toEqual([]);

    expect(isErr(await repo.listKnowledgePoints('  '))).toBe(true);
    expect(isErr(await repo.saveKnowledgePoints({ documentId: '', lessonId: 'l1', points: [{ concept: 'c' }] }))).toBe(
      true
    );
  });

  it('守卫：空 concept / 非法 kind / 空 points 拒绝', async () => {
    expect(
      isErr(
        await repo.saveKnowledgePoints({ documentId: 'd_kp', lessonId: 'l1', points: [{ concept: '  ' }] })
      )
    ).toBe(true);
    expect(
      isErr(
        await repo.saveKnowledgePoints({
          documentId: 'd_kp',
          lessonId: 'l1',
          points: [{ concept: 'c', kind: 'nope' }],
        })
      )
    ).toBe(true);
    expect(isErr(await repo.saveKnowledgePoints({ documentId: 'd_kp', lessonId: 'l1', points: [] }))).toBe(
      true
    );
  });
});

describe('library.save_knowledge_points Tool', () => {
  it('schema 拒绝非法输入（空 points / 空 concept / 非法 kind）', () => {
    expect(
      LibraryKnowledgeSaveInputSchema.safeParse({ documentId: 'd', lessonId: 'l', points: [] }).success
    ).toBe(false);
    expect(
      LibraryKnowledgeSaveInputSchema.safeParse({
        documentId: 'd',
        lessonId: 'l',
        points: [{ concept: '' }],
      }).success
    ).toBe(false);
    expect(
      LibraryKnowledgeSaveInputSchema.safeParse({
        documentId: 'd',
        lessonId: 'l',
        points: [{ concept: 'c', kind: 'nope' }],
      }).success
    ).toBe(false);
    expect(
      LibraryKnowledgeSaveInputSchema.safeParse({
        documentId: 'd',
        lessonId: 'l',
        points: [{ concept: 'に vs で', kind: 'rule', explanationMd: 'e' }],
      }).success
    ).toBe(true);
  });

  it('execute 在真仓储落库并返回计数', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new LibraryKnowledgeSaveTool(repo);
    expect(tool.name).toBe('library.save_knowledge_points');
    const res = await tool.execute(
      {
        documentId: 'd_tool',
        lessonId: 'l1',
        points: [{ concept: 'て形', kind: 'grammar_ref', explanationMd: '中顿' }],
      },
      { userId: 'u1', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({ saved: 1, updated: 0 });
    const listed = await repo.listKnowledgePoints('d_tool', 'l1');
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.map((p) => p.concept)).toEqual(['て形']);
    repo.getRawDb().close();
  });
});
