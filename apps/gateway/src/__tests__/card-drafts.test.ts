import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

const DRAFT = {
  userId: 'u1',
  language: 'ja',
  headword: '曖昧',
  reading: 'あいまい',
  meanings: ['含糊', '暧昧'],
  partOfSpeech: '形容词',
  source: 'agent' as const,
  sourceRef: 'doc1/lesson3',
};

describe('card-drafts（生词草稿）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('提议→列表：幂等去重，同键第二次返回空', async () => {
    const first = await repo.proposeCardDrafts([DRAFT]);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.length).toBe(1);
    expect(first.value[0]?.status).toBe('pending');
    const second = await repo.proposeCardDrafts([DRAFT]);
    if (!isOk(second)) return;
    expect(second.value.length).toBe(0);
    // 不同 sourceRef 视为不同提议
    const other = await repo.proposeCardDrafts([{ ...DRAFT, sourceRef: 'doc2/lesson1' }]);
    if (!isOk(other)) return;
    expect(other.value.length).toBe(1);
  });

  it('非法提议拒绝：坏语种/空词/空释义/超量', async () => {
    const badLang = await repo.proposeCardDrafts([{ ...DRAFT, language: 'fr' }]);
    expect(isOk(badLang)).toBe(false);
    const emptyMeanings = await repo.proposeCardDrafts([{ ...DRAFT, meanings: [] }]);
    expect(isOk(emptyMeanings)).toBe(false);
    const tooMany = await repo.proposeCardDrafts(
      Array.from({ length: 51 }, (_, i) => ({ ...DRAFT, headword: `词${i}` }))
    );
    expect(isOk(tooMany)).toBe(false);
  });

  it('逐字段改：edited_fields 累积；改表记即改键', async () => {
    const proposed = await repo.proposeCardDrafts([DRAFT]);
    if (!isOk(proposed)) return;
    const id = proposed.value[0]!.id;
    const updated = await repo.updateCardDraft('u1', id, {
      meanings: ['含糊不清'],
      partOfSpeech: 'な形容词',
    });
    expect(isOk(updated)).toBe(true);
    if (!isOk(updated)) return;
    expect(updated.value.meanings).toEqual(['含糊不清']);
    expect(updated.value.editedFields.sort()).toEqual(['meanings', 'partOfSpeech']);
    const renamed = await repo.updateCardDraft('u1', id, { headword: '曖昧さ' });
    if (!isOk(renamed)) return;
    expect(renamed.value.headword).toBe('曖昧さ');
    expect(renamed.value.termKey).not.toBe(updated.value.termKey);
  });

  it('改键撞车拒绝：与另一条 pending 同源草稿重复', async () => {
    const a = await repo.proposeCardDrafts([DRAFT]);
    const b = await repo.proposeCardDrafts([{ ...DRAFT, headword: '明確', reading: 'めいかく' }]);
    if (!isOk(a) || !isOk(b)) return;
    const clash = await repo.updateCardDraft('u1', b.value[0]!.id, {
      headword: '曖昧',
      reading: 'あいまい',
    });
    expect(isOk(clash)).toBe(false);
  });

  it('接受入库：建卡+草稿 accepted+相遇词 collected', async () => {
    const proposed = await repo.proposeCardDrafts([DRAFT]);
    if (!isOk(proposed)) return;
    const id = proposed.value[0]!.id;
    const accepted = await repo.acceptCardDraft('u1', id);
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.draft.status).toBe('accepted');
    expect(accepted.value.draft.flashcardId).toBe(accepted.value.cardId);
    const card = repo
      .getRawDb()
      .query<{ front: string; fsrs: string; studied_at: string }, [string]>(
        'SELECT front AS front, fsrs AS fsrs, studied_at AS studied_at FROM flashcards WHERE id = ?'
      )
      .get(accepted.value.cardId);
    expect(card!.front).toBe('曖昧');
    // M6：草稿接受建卡 NEW 初始化与旧字面量语义一致，且 dueAt 与 studied_at 同一时钟
    const fsrs = JSON.parse(card!.fsrs) as {
      stability: number;
      difficulty: number;
      reps: number;
      lapses: number;
      dueAt: string;
      state: string;
    };
    expect(fsrs.stability).toBe(1);
    expect(fsrs.difficulty).toBe(5);
    expect(fsrs.reps).toBe(0);
    expect(fsrs.lapses).toBe(0);
    expect(fsrs.state).toBe('NEW');
    expect(fsrs.dueAt).toBe(card!.studied_at);
    const terms = await repo.listEncounteredTerms('u1', 'ja');
    if (!isOk(terms)) return;
    expect(terms.value[0]?.status).toBe('collected');
    // 重复接受拒绝
    const again = await repo.acceptCardDraft('u1', id);
    expect(isOk(again)).toBe(false);
    // 已处理草稿不可再改
    const editAfter = await repo.updateCardDraft('u1', id, { headword: 'x' });
    expect(isOk(editAfter)).toBe(false);
  });

  it('驳回：dismissed 保留行；用户隔离', async () => {
    const proposed = await repo.proposeCardDrafts([DRAFT]);
    if (!isOk(proposed)) return;
    const id = proposed.value[0]!.id;
    const dismissed = await repo.dismissCardDraft('u1', id);
    expect(isOk(dismissed)).toBe(true);
    if (!isOk(dismissed)) return;
    expect(dismissed.value.status).toBe('dismissed');
    const pending = await repo.listCardDrafts('u1', 'ja');
    if (!isOk(pending)) return;
    expect(pending.value).toEqual([]);
    const dismissedList = await repo.listCardDrafts('u1', 'ja', 'dismissed');
    if (!isOk(dismissedList)) return;
    expect(dismissedList.value.length).toBe(1);
    // 跨用户不可见不可操作
    const other = await repo.acceptCardDraft('u2', id);
    expect(isOk(other)).toBe(false);
  });

  it('ai-enrich 来源提议可用（enrich 路由同构：sourceRef=文档/课）', async () => {
    const res = await repo.proposeCardDrafts([
      {
        userId: 'u1',
        language: 'ja',
        headword: '初めまして',
        reading: 'はじめまして',
        meanings: ['初次见面'],
        partOfSpeech: '寒暄',
        source: 'ai-enrich',
        sourceRef: 'doc1/l1',
      },
    ]);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]?.source).toBe('ai-enrich');
    expect(res.value[0]?.sourceRef).toBe('doc1/l1');
  });

  it('迁移版本全部落库', () => {
    const rows = repo
      .getRawDb()
      .query<{ version: number }, []>(
        'SELECT version AS version FROM schema_migrations ORDER BY version'
      )
      .all();
    expect(rows.map((r) => r.version).slice(0, 3)).toEqual([1, 2, 3]);
  });
});

describe('reading-positions（阅读位置游标）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('空位置返回 null；保存后读回；二次保存覆盖', async () => {
    const empty = await repo.getReadingPosition('u1', 'doc9');
    expect(isOk(empty)).toBe(true);
    if (!isOk(empty)) return;
    expect(empty.value).toBeNull();
    const saved = await repo.saveReadingPosition('u1', 'doc9', { lessonId: 'L3', offset: 120 });
    expect(isOk(saved)).toBe(true);
    const again = await repo.saveReadingPosition('u1', 'doc9', { lessonId: 'L5', page: 44 });
    if (!isOk(again)) return;
    expect(again.value.locator).toEqual({ lessonId: 'L5', page: 44 });
    const count = repo
      .getRawDb()
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM reading_positions WHERE user_id = 'u1'"
      )
      .get();
    expect(count!.n).toBe(1);
  });

  it('非法 locator 拒绝：数组/字符串/空', async () => {
    for (const bad of [['x'], 'L3', null, 42]) {
      const res = await repo.saveReadingPosition('u1', 'doc9', bad);
      expect(isOk(res)).toBe(false);
    }
  });
});

describe('card-drafts 句子类型（课文收句子）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  const SENTENCE =
    '昨日は友達と一緒に新しいカフェに行きました。とても賑やかでした。';

  it('提议句子草稿：kind/cardType 落库，长句不断尾', async () => {
    const res = await repo.proposeCardDrafts([
      {
        userId: 'u1',
        language: 'ja',
        headword: SENTENCE,
        meanings: ['昨天和朋友去了一家新咖啡馆，很热闹。'],
        partOfSpeech: '课文句子',
        source: 'import',
        sourceRef: 'doc1/l1',
        kind: 'sentence',
        cardType: 'SENTENCE',
      },
    ]);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(1);
    expect(res.value[0]?.kind).toBe('sentence');
    expect(res.value[0]?.cardType).toBe('SENTENCE');
    expect(res.value[0]?.headword).toBe(SENTENCE);
  });

  it('kind 非法拒绝；cardType 非法拒绝', async () => {
    const badKind = await repo.proposeCardDrafts([
      {
        userId: 'u1',
        language: 'ja',
        headword: 'あめ',
        meanings: ['雨'],
        source: 'agent',
        kind: 'paragraph' as never,
      },
    ]);
    expect(isOk(badKind)).toBe(false);
    const badType = await repo.proposeCardDrafts([
      {
        userId: 'u1',
        language: 'ja',
        headword: 'あめ',
        meanings: ['雨'],
        source: 'agent',
        cardType: 'ESSAY' as never,
      },
    ]);
    expect(isOk(badType)).toBe(false);
  });

  it('接受句子草稿：建成 SENTENCE 卡，不记相遇词', async () => {
    const proposed = await repo.proposeCardDrafts([
      {
        userId: 'u1',
        language: 'ja',
        headword: SENTENCE,
        meanings: ['昨天和朋友去了一家新咖啡馆，很热闹。'],
        partOfSpeech: '课文句子',
        source: 'import',
        sourceRef: 'doc1/l1',
        kind: 'sentence',
      },
    ]);
    if (!isOk(proposed)) return;
    const accepted = await repo.acceptCardDraft('u1', proposed.value[0]!.id);
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.draft.cardType).toBe('SENTENCE');
    const card = repo
      .getRawDb()
      .query<{ type: string; studied: string | null }, [string]>(
        'SELECT type AS type, studied_at AS studied FROM flashcards WHERE id = ?'
      )
      .get(accepted.value.cardId);
    expect(card!.type).toBe('SENTENCE');
    expect(card!.studied).not.toBeNull();
    // 相遇词无此整句
    const terms = await repo.listEncounteredTerms('u1', 'ja', 100);
    if (!isOk(terms)) return;
    expect(terms.value.some((t) => t.headword === SENTENCE)).toBe(false);
  });

  describe('P4-1 草稿选区关联', () => {
    async function seedSelection(
      id: string,
      userId: string,
      documentId: string | null
    ): Promise<void> {
      repo
        .getRawDb()
        .prepare(
          `INSERT INTO selection_contexts
             (id, user_id, language, document_id, surface, normalized_text, created_at)
           VALUES (?, ?, 'ja', ?, '表层', '归一', 't')`
        )
        .run(id, userId, documentId);
    }

    it('自有选区：提议建链，接受保留', async () => {
      repo
        .getRawDb()
        .prepare(
          `INSERT INTO documents (id, user_id, title, source_kind, language, content, created_at, updated_at)
           VALUES ('dSel', 'u1', 'T', 'user_import', 'ja', 'c', 't', 't')`
        )
        .run();
      await seedSelection('sel1', 'u1', 'dSel');
      const proposed = await repo.proposeCardDrafts([
        {
          userId: 'u1',
          language: 'ja',
          headword: '選区語',
          meanings: ['释义'],
          source: 'agent',
          selectionContextId: 'sel1',
        },
      ]);
      expect(isOk(proposed)).toBe(true);
      if (!isOk(proposed)) return;
      expect(proposed.value[0]!.selectionContextId).toBe('sel1');
      const accepted = await repo.acceptCardDraft('u1', proposed.value[0]!.id);
      expect(isOk(accepted)).toBe(true);
      if (!isOk(accepted)) return;
      // 同一事务保留关联（列未被接受流程覆盖）。
      expect(accepted.value.draft.selectionContextId).toBe('sel1');
      const row = repo
        .getRawDb()
        .query<{ sel: string | null }, [string]>(
          'SELECT selection_context_id AS sel FROM card_drafts WHERE id = ?'
        )
        .get(proposed.value[0]!.id);
      expect(row!.sel).toBe('sel1');
    });

    it('跨用户／幽灵选区：拒绝建链，无草稿残留', async () => {
      await seedSelection('sel-other', 'uB', null);
      const cross = await repo.proposeCardDrafts([
        {
          userId: 'u1',
          language: 'ja',
          headword: '跨用户詞',
          meanings: ['释义'],
          source: 'agent',
          selectionContextId: 'sel-other',
        },
      ]);
      expect(isOk(cross)).toBe(false);
      if (isOk(cross)) return;
      expect(cross.error.code).toBe('E_NOT_FOUND');
      const ghost = await repo.proposeCardDrafts([
        {
          userId: 'u1',
          language: 'ja',
          headword: '幽灵詞',
          meanings: ['释义'],
          source: 'agent',
          selectionContextId: 'sel-ghost',
        },
      ]);
      expect(isOk(ghost)).toBe(false);
      const n = repo
        .getRawDb()
        .query<{ n: number }, []>('SELECT COUNT(*) AS n FROM card_drafts')
        .get();
      expect(n!.n).toBe(0);
    });
  });
});
