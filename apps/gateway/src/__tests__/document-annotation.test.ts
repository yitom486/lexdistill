import { describe, it, expect, beforeEach } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { app } from '../index.js';
import { isOk, isErr } from '@study-studio/shared';
import type { DocumentItem, AnnotationItem } from '@study-studio/protocol';
import type { StandardErrorPayload } from '../errors/http-error-handler.js';

describe('Document & Annotation Repository (Companion Integration)', () => {
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_ast_01';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('should save and retrieve a textbook AST document', async () => {
    const doc: DocumentItem = {
      id: 'doc_shinpen_01',
      userId: testUserId,
      title: '新编日语 第一册',
      sourceKind: 'user_import',
      language: 'ja',
      content: '第1課 五十音図と挨拶\nおはようございます。',
      astJson: JSON.stringify({
        id: 'shinpen-nihongo-1',
        title: '新编日语 第一册',
        lessons: [
          {
            id: 'l1',
            lessonNumber: 1,
            title: '第1課',
            vocabularies: [
              {
                id: 'v1',
                kanji: 'おはようございます',
                kana: 'おはようございます',
                chinese: '早上好',
                pos: '寒暄语',
                pitchAccent: '④',
              },
            ],
            grammarPoints: [],
            dialogues: [],
          },
        ],
      }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saveRes = await repo.saveDocument(doc);
    expect(isOk(saveRes)).toBe(true);

    const listRes = await repo.listDocuments(testUserId);
    expect(isOk(listRes)).toBe(true);
    if (isOk(listRes)) {
      // curriculum_textbook 为公共资产，同列表可见；断言自有文档在列即可
      expect(listRes.value.some((d) => d.id === 'doc_shinpen_01')).toBe(true);
      expect(listRes.value.length).toBeGreaterThanOrEqual(1);
    }

    const getRes = await repo.getDocumentById('doc_shinpen_01');
    expect(isOk(getRes)).toBe(true);
    if (isOk(getRes)) {
      expect(getRes.value?.id).toBe('doc_shinpen_01');
      expect(getRes.value?.language).toBe('ja');
    }
  });

  it('should save an annotation and convert it atomically to a flashcard', async () => {
    // 1. 先保存文档
    await repo.saveDocument({
      id: 'doc_read_01',
      userId: testUserId,
      title: '日语精读散文',
      sourceKind: 'ai_generated',
      language: 'ja',
      content: '春の夜の夢の浮橋とだえして、峰にわかるる横雲の空。',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 2. 划线批注
    const ann: AnnotationItem = {
      id: 'ann_test_01',
      documentId: 'doc_read_01',
      userId: testUserId,
      kind: 'VOCAB',
      quote: '浮桥（うきはし）',
      note: '比喻虚浮不实的事物或短暂相聚',
      startOffset: 6,
      endOffset: 8,
      createdBy: 'USER',
      createdAt: new Date().toISOString(),
    };
    const annRes = await repo.saveAnnotation(ann);
    expect(isOk(annRes)).toBe(true);

    const listAnnRes = await repo.listAnnotations('doc_read_01', testUserId);
    expect(isOk(listAnnRes)).toBe(true);
    if (isOk(listAnnRes)) {
      expect(listAnnRes.value.length).toBe(1);
      expect(listAnnRes.value[0]!.quote).toBe('浮桥（うきはし）');
    }

    // 3. 一键转化为 FSRS 记忆闪卡
    const toCardRes = await repo.convertAnnotationToCard('ann_test_01', testUserId, {
      front: '浮橋（うきはし）',
      back: '虚幻之桥；浮桥',
      tag: '古典散文',
      pos: '名词',
    });
    expect(isOk(toCardRes)).toBe(true);
    if (isOk(toCardRes)) {
      expect(toCardRes.value.front).toBe('浮橋（うきはし）');
      expect(toCardRes.value.fsrs.state).toBe('NEW');
    }

    // 4. 验证批注已回填 flashcardId
    const updatedAnns = await repo.listAnnotations('doc_read_01', testUserId);
    if (isOk(updatedAnns)) {
      expect(updatedAnns.value[0]!.flashcardId).toBeDefined();
    }

    // 5. 验证闪卡库中已存在该卡片
    const cardsRes = await repo.getDueCards(testUserId);
    expect(isOk(cardsRes)).toBe(true);
    if (isOk(cardsRes)) {
      expect(cardsRes.value.some((c) => c.front === '浮橋（うきはし）')).toBe(true);
    }

    // 6. 短 quote 转卡同步记相遇（collect 级，卡已回填）
    const termsRes = await repo.listEncounteredTerms(testUserId, 'ja');
    expect(isOk(termsRes)).toBe(true);
    if (isOk(termsRes)) {
      const hit = termsRes.value.find((t) => t.headword === '浮桥（うきはし）');
      expect(hit?.status).toBe('collected');
      expect(hit?.flashcardId).toBeDefined();
    }
  });

  it('长 quote 转卡不记相遇（整句不污染词信号，但建卡不受影响）', async () => {
    await repo.saveDocument({
      id: 'doc_long_01',
      userId: testUserId,
      title: '长句文档',
      sourceKind: 'user_import',
      language: 'ja',
      content: '春の夜の夢の浮橋とだえして峰にわかるる横雲の空。',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repo.saveAnnotation({
      id: 'ann_long_01',
      documentId: 'doc_long_01',
      userId: testUserId,
      kind: 'KEY_POINT',
      quote: '春の夜の夢の浮橋とだえして、峰にわかるる横雲の空。',
      createdBy: 'USER',
      startOffset: 0,
      endOffset: 24,
      createdAt: new Date().toISOString(),
    });
    const toCardRes = await repo.convertAnnotationToCard('ann_long_01', testUserId, {
      front: '春の夜の夢の浮橋',
      back: '春夜梦之浮桥',
    });
    expect(isOk(toCardRes)).toBe(true);
    const termsRes = await repo.listEncounteredTerms(testUserId, 'ja');
    if (isOk(termsRes)) {
      expect(termsRes.value.length).toBe(0);
    }
  });

  it('should handle deletion of annotations and documents', async () => {
    await repo.saveDocument({
      id: 'doc_del_01',
      userId: testUserId,
      title: '待删除教材',
      sourceKind: 'user_import',
      language: 'ja',
      content: '测试内容',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await repo.saveAnnotation({
      id: 'ann_del_01',
      documentId: 'doc_del_01',
      userId: testUserId,
      kind: 'KEY_POINT',
      quote: '测试内容',
      startOffset: 0,
      endOffset: 4,
      createdBy: 'USER',
      createdAt: new Date().toISOString(),
    });

    // 删除批注
    const delAnnRes = await repo.deleteAnnotation('ann_del_01', testUserId);
    expect(isOk(delAnnRes)).toBe(true);

    const anns = await repo.listAnnotations('doc_del_01', testUserId);
    if (isOk(anns)) {
      expect(anns.value.length).toBe(0);
    }

    // 删除文档
    const delDocRes = await repo.deleteDocument('doc_del_01', testUserId);
    expect(isOk(delDocRes)).toBe(true);

    const doc = await repo.getDocumentById('doc_del_01');
    if (isOk(doc)) {
      expect(doc.value).toBeNull();
    }
  });

  it('curriculum_textbook 是公共资产：其他用户可见，自有文档仍隔离', async () => {
    const mine: DocumentItem = {
      id: 'doc_mine_01',
      userId: testUserId,
      title: '我的自有文档',
      sourceKind: 'user_import',
      language: 'ja',
      content: '私有',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(isOk(await repo.saveDocument(mine))).toBe(true);
    expect(isOk(await repo.saveDocument({ ...mine, id: `${mine.id}-public`, sourceKind: 'curriculum_textbook' }))).toBe(true);
    const listRes = await repo.listDocuments('someone_else');
    expect(isOk(listRes)).toBe(true);
    if (!isOk(listRes)) return;
    const kinds = listRes.value.map((d) => d.sourceKind);
    expect(kinds).toContain('curriculum_textbook');
    expect(listRes.value.some((d) => d.id === 'doc_mine_01')).toBe(false);
  });
});

describe('Document & Annotation Hono RPC Routes', () => {
  const testUserId = 'test_http_user_02';

  it('should post and get document via HTTP endpoints', async () => {
    const postRes = await app.request(`/api/documents/${testUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'doc_http_test_01',
        title: 'HTTP 测试教材',
        sourceKind: 'user_import',
        language: 'ja',
        content: '第一课课文',
      }),
    });
    expect(postRes.status).toBe(200);

    const getRes = await app.request(`/api/documents/${testUserId}`);
    expect(getRes.status).toBe(200);
    const docs = (await getRes.json()) as DocumentItem[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.some((d) => d.id === 'doc_http_test_01')).toBe(true);
  });

  it('should reject invalid annotation input with friendly BusinessError', async () => {
    const postRes = await app.request(`/api/annotations/${testUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: '', // 空文档 ID
        quote: '', // 空摘录
      }),
    });
    expect(postRes.status).toBe(400);
    const body = (await postRes.json()) as StandardErrorPayload;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('E_INVALID_INPUT');
    expect(body.error.userMessage).toContain('批注必须包含所属文档与划线摘录');
  });
});

describe('deleteDocument 生命周期（P0.5）', () => {
  let repo: DrizzleLearnerRepository;
  const testUserId = 'test_user_del_lifecycle';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  const BOOK = {
    id: 'lifecycle-book',
    language: 'JA' as const,
    title: '删前有料书',
    shortTitle: '删',
    level: 'N5',
    lessons: [
      {
        id: 'll1',
        lessonNumber: 1,
        title: '第1課',
        vocabularies: [
          {
            id: 'lv1',
            kanji: '食べる',
            kana: 'たべる',
            pos: '动词',
            pitchAccent: '②',
            chinese: '吃',
            example: { japanese: 'ご飯を食べる', chinese: '吃饭' },
          },
        ],
        grammarPoints: [],
        dialogues: [{ speaker: 'A', japanese: 'おはよう', chinese: '早上好' }],
        exercises: [],
      },
    ],
  };

  async function seedFullDoc(docId: string): Promise<void> {
    const now = new Date().toISOString();
    const saved = await repo.saveDocument({
      id: docId,
      userId: testUserId,
      title: '待删书',
      sourceKind: 'user_import',
      language: 'ja',
      content: 'x',
      astJson: JSON.stringify(BOOK),
      createdAt: now,
      updatedAt: now,
    });
    expect(isOk(saved)).toBe(true);
    const shredded = await repo.shredDocument(docId, BOOK);
    expect(isOk(shredded)).toBe(true);
    expect(isOk(await repo.saveAnnotation({
      id: `ann-${docId}`,
      documentId: docId,
      userId: testUserId,
      kind: 'KEY_POINT',
      quote: 'おはよう',
      createdBy: 'USER',
      startOffset: 0,
      endOffset: 4,
      createdAt: now,
    }))).toBe(true);
    expect(isOk(await repo.saveReadingPosition(testUserId, docId, { lessonId: 'll1' }))).toBe(true);
    expect(isOk(await repo.saveDocumentStructure(testUserId, docId, {
      headings: [],
      classes: [],
      model: 'm',
      effort: 'e',
      dropped: 0,
    }))).toBe(true);
  }

  function countFor(docId: string, table: string): number {
    const row = repo
      .getRawDb()
      .query(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id = ?`)
      .get(docId) as { n: number };
    return row.n;
  }

  it('删除清掉 shred/FTS/位置/批注/结构，doctor 无孤儿', async () => {
    const { runDoctor } = await import('@study-studio/storage-sqlite');
    await seedFullDoc('doc_life_01');
    expect(countFor('doc_life_01', 'textbook_vocabulary')).toBe(1);
    expect(countFor('doc_life_01', 'textbook_fts')).toBe(2);

    const del = await repo.deleteDocument('doc_life_01', testUserId);
    expect(isOk(del)).toBe(true);
    for (const t of [
      'textbook_materials', 'textbook_sentences', 'textbook_vocabulary', 'textbook_knowledge',
      'textbook_exercise_items', 'knowledge_points', 'textbook_fts',
      'reading_positions', 'annotations', 'document_structure',
    ]) {
      expect(countFor('doc_life_01', t)).toBe(0);
    }
    const got = await repo.getDocumentById('doc_life_01');
    expect(isOk(got) && got.value).toBe(null);

    const report = runDoctor(repo.getRawDb());
    expect(report.errors).toEqual([]);
  });

  it('事务中途失败整体回滚，不留半删除', async () => {
    await seedFullDoc('doc_life_02');
    // 破坏一张子表：事务内必抛，验证原子性
    repo.getRawDb().run('DROP TABLE textbook_sentences');
    const del = await repo.deleteDocument('doc_life_02', testUserId);
    expect(isOk(del)).toBe(false);
    // documents 本行与批注都在（回滚了）
    expect(repo.getRawDb().query("SELECT id FROM documents WHERE id='doc_life_02'").get()).toEqual({id:'doc_life_02'});
    const anns = await repo.listAnnotations('doc_life_02', testUserId);
    expect(isOk(anns) && anns.value.length).toBe(1);
  });

  it('别人的文档删不动（先验归属，不清 shred 行）', async () => {
    await seedFullDoc('doc_life_03');
    const del = await repo.deleteDocument('doc_life_03', 'intruder');
    expect(isOk(del)).toBe(false);
    const got = await repo.getDocumentById('doc_life_03');
    expect(isOk(got) && got.value !== null).toBe(true);
    expect(countFor('doc_life_03', 'textbook_vocabulary')).toBe(1);
  });
});
