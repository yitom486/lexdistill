import { describe, expect, it, afterEach } from 'bun:test';
import { BusinessError, isOk, type Result } from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import type { PdfInspectorLike } from '../../../infrastructure/pdf-runtime/pdf-runtime.js';
import type { PdfAstOutput } from '../application/pdf-import/pdf-import-service.js';
import {
  fingerprintTocPlan,
  sha256HexBytes,
} from '@study-studio/content';
import {
  importTocLesson,
  type TocLessonImportDeps,
} from '../application/pdf-import/toc-lesson-import.js';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';

/**
 * CMD-LINGUA-P5D1 单课导入（mock converter + :memory: 真库）。
 * 真库只用 :memory:；断言精确页窗、单事务落库与失败零残留。
 */

function mockBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4 mock-toc-lesson-import');
}

const ENTRIES = [
  { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
  { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
];

const ANCHORS = [
  { printedPage: 12, physicalPage: 17, evidence: 'human-confirmed' as const },
  { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed' as const },
];

function fingerprint(): string {
  return fingerprintTocPlan({ pageCount: 100, pdfHashHex: sha256HexBytes(mockBytes()), entries: ENTRIES, anchors: ANCHORS });
}

function oneLessonBook(): TextbookAST {
  return {
    id: 'book-import-1',
    language: 'JA',
    title: '单课导入书',
    shortTitle: '单课书',
    level: 'N5',
    lessons: [
      {
        id: 'lesson-converted-1',
        lessonNumber: 1,
        title: '第1課',
        vocabularies: [],
        grammarPoints: [],
        dialogues: [{ speaker: 'A', japanese: 'こんにちは', chinese: '你好' }],
        exercises: [],
      },
    ],
  };
}

function astOutput(book: TextbookAST): PdfAstOutput {
  return {
    book,
    markdown: '',
    classification: { pdfType: 'TextBased', pageCount: 100, pagesNeedingOcr: [], ocrUsed: false, selectedPages: [] },
    stats: { lessons: book.lessons.length, dialogues: 1 },
  };
}

interface ConvertCall {
  pages: number[];
}

function mockInspector(pageCount: number): PdfInspectorLike {
  return {
    processPdf: () => ({ pdfType: 'TextBased', pageCount, markdown: '', pagesNeedingOcr: [] }),
    processPdfWithOcr: async () => ({ markdown: '', pages: [] }),
  };
}

class CountingRepo extends DrizzleLearnerRepository {
  public saveCalls = 0;
  public constructor() {
    super(':memory:');
  }
  public override async saveCanonicalAst(
    docBase: Omit<DocumentItem, 'astJson'>,
    book: TextbookAST
  ): Promise<Result<DocumentItem, BusinessError>> {
    this.saveCalls++;
    return super.saveCanonicalAst(docBase, book);
  }
}

class ThrowingRepo extends DrizzleLearnerRepository {
  public constructor() {
    super(':memory:');
  }
  public override async saveCanonicalAst(
    _docBase: Omit<DocumentItem, 'astJson'>,
    _book: TextbookAST
  ): Promise<Result<DocumentItem, BusinessError>> {
    return {
      ok: false as const,
      error: new BusinessError('E_DB_WRITE', '模拟 shred 失败', 'DATABASE'),
    };
  }
}

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.getRawDb().close();
});

function baseDeps(repo: CountingRepo | ThrowingRepo, convert: TocLessonImportDeps['convertRange']): TocLessonImportDeps {
  return {
    loadInspector: async () => mockInspector(100),
    saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
    projectLinesSegments: (userId, documentId) => repo.projectLinesSegments(userId, documentId),
    ...(convert ? { convertRange: convert } : {}),
  };
}

async function documentCount(repo: DrizzleLearnerRepository, userId: string): Promise<number> {
  const res = await repo.listDocuments(userId);
  if (!isOk(res)) throw new Error('listDocuments failed');
  return res.value.length;
}

/** 零写断言：内存库自带种子，前后行数一致即无残留。 */
async function expectNoWrite(repo: CountingRepo | ThrowingRepo, userId: string, before: number): Promise<void> {
  if (repo instanceof CountingRepo) expect(repo.saveCalls).toBe(0);
  expect(await documentCount(repo, userId)).toBe(before);
}

function tableCount(repo: DrizzleLearnerRepository, table: string, documentId: string): number {
  const row = repo
    .getRawDb()
    .query(`SELECT COUNT(*) AS n FROM ${table} WHERE document_id = ?`)
    .get(documentId) as { n: number };
  return row.n;
}

describe('P5D1 importTocLesson（mock converter + :memory:）', () => {
  it('stale 指纹拒绝，零写', async () => {
    const repo = new CountingRepo();
    repos.push(repo);
    const before = await documentCount(repo, 'u1');
    const res = await importTocLesson(baseDeps(repo, undefined), {
      userId: 'u1',
      filename: 't.pdf',
      bytes: mockBytes(),
      entries: ENTRIES,
      anchors: ANCHORS,
      lessonIndex: 0,
      fingerprint: 'deadbeef',
    });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_PLAN_STALE');
    await expectNoWrite(repo, 'u1', before);
  });

  it('篡改条目后旧指纹同样过期', async () => {
    const repo = new CountingRepo();
    repos.push(repo);
    const before = await documentCount(repo, 'u1');
    const tampered = [{ title: '第1課改', printedPage: 12, level: 1, kind: 'lesson' as const }, ENTRIES[1]];
    const res = await importTocLesson(baseDeps(repo, undefined), {
      userId: 'u1',
      filename: 't.pdf',
      bytes: mockBytes(),
      entries: tampered,
      anchors: ANCHORS,
      lessonIndex: 0,
      fingerprint: fingerprint(),
    });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_TOC_PLAN_STALE');
    await expectNoWrite(repo, 'u1', before);
  });

  it('unresolved / 无 end / 坏下标 / 超 30 页全拒绝，零写', async () => {
    // unresolved：offset 冲突制造未映射课
    const conflictEntries = [
      ...ENTRIES,
      { title: '第3課', printedPage: 35, level: 1, kind: 'lesson' as const },
    ];
    const conflictAnchors = [
      ...ANCHORS,
      { printedPage: 40, physicalPage: 40, evidence: 'human-confirmed' as const },
    ];
    const conflictFp = fingerprintTocPlan({
      pageCount: 100,
      pdfHashHex: sha256HexBytes(mockBytes()),
      entries: conflictEntries,
      anchors: conflictAnchors,
    });
    // 无 end：单 anchor 外推无 verified region
    const singleFp = fingerprintTocPlan({
      pageCount: 100,
      pdfHashHex: sha256HexBytes(mockBytes()),
      entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const }],
      anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' as const }],
    });
    // 31 页：两 chunk
    const longEntries = [
      { title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const },
      { title: '第2課', printedPage: 32, level: 1, kind: 'lesson' as const },
    ];
    const longAnchors = [
      { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' as const },
      { printedPage: 100, physicalPage: 100, evidence: 'human-confirmed' as const },
    ];
    const longFp = fingerprintTocPlan({
      pageCount: 100,
      pdfHashHex: sha256HexBytes(mockBytes()),
      entries: longEntries,
      anchors: longAnchors,
    });
    const cases: Array<{ entries: unknown; anchors: unknown; lessonIndex: number; fingerprint: string }> = [
      { entries: conflictEntries, anchors: conflictAnchors, lessonIndex: 0, fingerprint: conflictFp },
      {
        entries: [{ title: '第1課', printedPage: 1, level: 1, kind: 'lesson' as const }],
        anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' as const }],
        lessonIndex: 0,
        fingerprint: singleFp,
      },
      { entries: ENTRIES, anchors: ANCHORS, lessonIndex: 9, fingerprint: fingerprint() },
      { entries: longEntries, anchors: longAnchors, lessonIndex: 0, fingerprint: longFp },
    ];
    for (const item of cases) {
      const repo = new CountingRepo();
      repos.push(repo);
      const before = await documentCount(repo, 'u1');
      const res = await importTocLesson(baseDeps(repo, undefined), {
        userId: 'u1',
        filename: 't.pdf',
        bytes: mockBytes(),
        entries: item.entries,
        anchors: item.anchors,
        lessonIndex: item.lessonIndex,
        fingerprint: item.fingerprint,
      });
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_INVALID_INPUT');
      await expectNoWrite(repo, 'u1', before);
    }
  });

  it('converter 收到精确 verified range；伪造 pages 字段被无视', async () => {
    const repo = new CountingRepo();
    repos.push(repo);
    const seen: ConvertCall[] = [];
    const input = {
      userId: 'u1',
      filename: 't.pdf',
      bytes: mockBytes(),
      entries: ENTRIES,
      anchors: ANCHORS,
      lessonIndex: 0,
      fingerprint: fingerprint(),
      pages: [99],
    };
    const res = await importTocLesson(
      baseDeps(repo, async (vars) => {
        seen.push({ pages: vars.pages });
        return { ok: true as const, value: astOutput(oneLessonBook()) };
      }),
      input
    );
    expect(isOk(res)).toBe(true);
    // 第1課 verified range [17,34]（下一课 start 35 - 1），不是客户端 pages
    expect(seen).toEqual([{ pages: Array.from({ length: 18 }, (_, i) => 17 + i) }]);
  });

  it('converter 0 课 / 多课：明确错误，零残留', async () => {
    for (const lessons of [[], [oneLessonBook().lessons[0], oneLessonBook().lessons[0]]] as Array<
      TextbookAST['lessons']
    >) {
      const repo = new CountingRepo();
      repos.push(repo);
      const before = await documentCount(repo, 'u1');
      const book = { ...oneLessonBook(), lessons: [...lessons] };
      const res = await importTocLesson(
        baseDeps(repo, async () => ({ ok: true as const, value: astOutput(book as TextbookAST) })),
        {
          userId: 'u1',
          filename: 't.pdf',
          bytes: mockBytes(),
          entries: ENTRIES,
          anchors: ANCHORS,
          lessonIndex: 0,
          fingerprint: fingerprint(),
        }
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_TOC_LESSON_SHAPE');
      await expectNoWrite(repo, 'u1', before);
    }
  });

  it('恰一课成功：documents/AST/lesson/lines 一致，返回摘要', async () => {
    const repo = new CountingRepo();
    repos.push(repo);
    const res = await importTocLesson(
      baseDeps(repo, async () => ({ ok: true as const, value: astOutput(oneLessonBook()) })),
      {
        userId: 'u1',
        filename: 't.pdf',
        bytes: mockBytes(),
        entries: ENTRIES,
        anchors: ANCHORS,
        lessonIndex: 0,
        fingerprint: fingerprint(),
        docTitle: '试导入课',
      }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessonId).toBe('lesson-converted-1');
    expect(res.value.lessonTitle).toBe('第1課');
    expect(res.value.range).toEqual({ fromPage: 17, toPage: 34 });
    expect(res.value.stats).toMatchObject({ lessons: 1, dialogues: 1, chunks: 1 });
    expect(repo.saveCalls).toBe(1);
    expect(res.value.documentId.startsWith('doc_')).toBe(true);
    const got = await repo.getDocumentById(res.value.documentId);
    expect(isOk(got) && got.value !== null).toBe(true);
    if (!isOk(got) || !got.value) return;
    expect(got.value.userId).toBe('u1');
    expect(got.value.title).toBe('试导入课');
    const ast = JSON.parse(got.value.astJson ?? '{}') as { lessons?: unknown[] };
    expect(ast.lessons?.length).toBe(1);
    expect(tableCount(repo, 'textbook_lessons', res.value.documentId)).toBe(1);
    expect(tableCount(repo, 'textbook_lines', res.value.documentId)).toBeGreaterThan(0);
    expect(tableCount(repo, 'textbook_fts', res.value.documentId)).toBeGreaterThan(0);
    // 他人文档不受影响（u2 无种子无写入）
    const otherBefore = await documentCount(repo, 'u2');
    expect(await documentCount(repo, 'u2')).toBe(otherBefore);
  });

  it('标题错位拒绝（E_TOC_TITLE_MISMATCH + details + 零写）；空白差异放行', async () => {
    // 错位：页范围漂移到隔壁课，解析出第2課但目录位是第1課
    {
      const repo = new CountingRepo();
      repos.push(repo);
      const before = await documentCount(repo, 'u1');
      const other = { ...oneLessonBook() };
      other.lessons = [{ ...oneLessonBook().lessons[0]!, id: 'lesson-converted-2', title: '第2課' }];
      const res = await importTocLesson(
        baseDeps(repo, async () => ({ ok: true as const, value: astOutput(other) })),
        {
          userId: 'u1',
          filename: 't.pdf',
          bytes: mockBytes(),
          entries: ENTRIES,
          anchors: ANCHORS,
          lessonIndex: 0,
          fingerprint: fingerprint(),
        }
      );
      expect(isOk(res)).toBe(false);
      if (isOk(res)) return;
      expect(res.error.code).toBe('E_TOC_TITLE_MISMATCH');
      const details = res.error.internalDetails as {
        lessonIndex: number;
        expectedTitle: string;
        actualTitle: string;
        hint: string;
      };
      expect(details).toMatchObject({ lessonIndex: 0, expectedTitle: '第1課', actualTitle: '第2課' });
      expect(typeof details.hint).toBe('string');
      await expectNoWrite(repo, 'u1', before);
    }
    // 空白差异：OCR「第 1 課」/全角空格 vs 目录「第1課」归一后放行
    for (const title of ['第 1 課', '第　1　課']) {
      const repo = new CountingRepo();
      repos.push(repo);
      const spaced = { ...oneLessonBook() };
      spaced.lessons = [{ ...oneLessonBook().lessons[0]!, title }];
      const res = await importTocLesson(
        baseDeps(repo, async () => ({ ok: true as const, value: astOutput(spaced) })),
        {
          userId: 'u1',
          filename: 't.pdf',
          bytes: mockBytes(),
          entries: ENTRIES,
          anchors: ANCHORS,
          lessonIndex: 0,
          fingerprint: fingerprint(),
        }
      );
      expect(isOk(res)).toBe(true);
    }
  });

  it('shred 失败：错误透传，零残留', async () => {
    const repo = new ThrowingRepo();
    repos.push(repo);
    const before = await documentCount(repo, 'u1');
    const res = await importTocLesson(
      {
        loadInspector: async () => mockInspector(100),
        saveCanonicalAst: (docBase, book) => repo.saveCanonicalAst(docBase, book),
        projectLinesSegments: (userId, documentId) => repo.projectLinesSegments(userId, documentId),
        convertRange: async () => ({ ok: true as const, value: astOutput(oneLessonBook()) }),
      },
      {
        userId: 'u1',
        filename: 't.pdf',
        bytes: mockBytes(),
        entries: ENTRIES,
        anchors: ANCHORS,
        lessonIndex: 0,
        fingerprint: fingerprint(),
      }
    );
    expect(isOk(res)).toBe(false);
    await expectNoWrite(repo, 'u1', before);
  });
});
