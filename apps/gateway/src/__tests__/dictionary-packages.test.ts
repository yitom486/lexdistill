import { describe, it, expect, beforeEach } from 'bun:test';
import {
  DICTIONARY_PACKAGE_CATALOG,
  KANJIUM_PITCH_SOURCE_ID,
  KENGDIC_SOURCE_ID,
  JMDICT_E_SOURCE_ID,
  OEWN_2025_SOURCE_ID,
  listDictionaryPackages,
  installDictionaryPackage,
  parseKengdicTsv,
  parseJmdictXml,
} from '../modules/dictionary/application/dictionary-packages.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { isOk, generateId } from '@lexdistill/shared';
import type { Flashcard } from '@lexdistill/protocol';

// 构造一份足够大的 mock Kengdic TSV（≥ minEntryCount=50_000）以通过完整性校验
function makeMockKengdicTsv(rows = 50_001): string {
  const lines: string[] = ['id\tsurface\thanja\tgloss\tlevel\tcreated\tsource'];
  for (let i = 1; i <= rows; i++) {
    // 用一组可检索的真实韩语词 + 唯一 id，保证 search 能命中
    const surface = i === 1 ? '안녕하세요' : `단어${i}`;
    const gloss = i === 1 ? 'hello; greeting' : `word number ${i}`;
    lines.push(
      `${i}\t${surface}\t\t${gloss}\t\t2006-01-16T09:52:46Z\tengdic-${i}@ezcorean:${i}`
    );
  }
  return lines.join('\n');
}

function makeMockFetcher(tsv: string): typeof fetch {
  const impl = async (_url: string): Promise<Response> => {
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return new TextEncoder().encode(tsv).buffer;
      },
    } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

function makeFailingFetcher(status = 503): typeof fetch {
  const impl = async (_url: string): Promise<Response> => {
    return { ok: false, status } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

// 构造一份足够大的 mock JMdict_e XML（≥ minEntryCount=100_000）以通过完整性校验
function makeMockJmdictXml(rows = 100_001): string {
  const parts: string[] = ['<JMdict>'];
  for (let i = 1; i <= rows; i++) {
    if (i === 1) {
      parts.push(
        '<entry><ent_seq>1000001</ent_seq><k_ele><keb>学生</keb></k_ele><r_ele><reb>がくせい</reb></r_ele><sense><pos>&n;</pos><gloss>student</gloss></sense></entry>'
      );
    } else {
      parts.push(
        `<entry><ent_seq>${1000000 + i}</ent_seq><k_ele><keb>単語${i}</keb></k_ele><r_ele><reb>たんご${i}</reb></r_ele><sense><pos>&n;</pos><gloss>word number ${i}</gloss></sense></entry>`
      );
    }
  }
  parts.push('</JMdict>');
  return parts.join('');
}

function makeMockGzipFetcher(xml: string): typeof fetch {
  const impl = async (_url: string): Promise<Response> => {
    const gzipped = Bun.gzipSync(new TextEncoder().encode(xml));
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength);
      },
    } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

describe('P3-A 词典包 manifest/catalog', () => {
  it('目录登记三种语种包，每个 manifest 含许可证/署名/来源 URL', () => {
    expect(DICTIONARY_PACKAGE_CATALOG.length).toBeGreaterThanOrEqual(3);
    const ids = DICTIONARY_PACKAGE_CATALOG.map((m) => m.id);
    expect(ids).toContain(OEWN_2025_SOURCE_ID);
    expect(ids).toContain(JMDICT_E_SOURCE_ID);
    expect(ids).toContain(KENGDIC_SOURCE_ID);

    for (const m of DICTIONARY_PACKAGE_CATALOG) {
      expect(m.licenseName.length).toBeGreaterThan(0);
      // CC 系走 creativecommons 链接；上游声明类（如 Kanjium）必须指向可核查的上游地址
      if (m.licenseName.startsWith('上游声明')) {
        expect(m.licenseUrl.startsWith('https://github.com/')).toBe(true);
      } else {
        expect(m.licenseUrl.startsWith('https://creativecommons.org/')).toBe(true);
      }
      expect(m.attribution.length).toBeGreaterThan(0);
      expect(m.sourceUrl.startsWith('http')).toBe(true);
      expect(['oewn-xml', 'jmdict-xml', 'kengdic-tsv', 'yomitan-zip']).toContain(m.parser);
    }
  });

  it('Kanjium 声调覆盖层已登记且可安装（yomitan-zip 解析器）', () => {
    const kanjium = DICTIONARY_PACKAGE_CATALOG.find((m) => m.id === KANJIUM_PITCH_SOURCE_ID);
    expect(kanjium).toBeDefined();
    expect(kanjium?.installerReady).toBe(true);
    expect(kanjium?.language).toBe('ja');
  });

  it('JMdict manifest 已登记且 installerReady=true（XML 解析器已实现）', () => {
    const jmdict = DICTIONARY_PACKAGE_CATALOG.find((m) => m.id === JMDICT_E_SOURCE_ID);
    expect(jmdict).toBeDefined();
    expect(jmdict?.installerReady).toBe(true);
    expect(jmdict?.licenseName).toBe('CC BY-SA 4.0');
    expect(jmdict?.language).toBe('ja');
  });

  it('Kengdic manifest 标记为可安装', () => {
    const kengdic = DICTIONARY_PACKAGE_CATALOG.find((m) => m.id === KENGDIC_SOURCE_ID);
    expect(kengdic).toBeDefined();
    expect(kengdic?.installerReady).toBe(true);
    expect(kengdic?.language).toBe('ko');
  });
});

describe('P3-A Kengdic TSV 解析器', () => {
  it('解析 TSV 行为扁平词条，跳过空 surface/gloss，拆分多释义', () => {
    const tsv = [
      'id\tsurface\thanja\tgloss\tlevel\tcreated\tsource',
      '1\t안녕하세요\t\thello; greeting\t\t2006-01-16T09:52:46Z\tx@ezcorean:1',
      '2\t\t\tempty surface\t\t2006-01-16T09:52:46Z\tx@ezcorean:2',
      '3\t단어\t\t\t\t2006-01-16T09:52:46Z\tx@ezcorean:3',
      '4\t학교\t學校\tschool\tA\t2006-01-16T09:52:46Z\tx@ezcorean:4',
    ].join('\n');
    const entries = parseKengdicTsv(tsv);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.headword).toBe('안녕하세요');
    expect(entries[0]?.meanings).toEqual(['hello', 'greeting']);
    expect(entries[1]?.headword).toBe('학교');
    expect(entries[1]?.meanings).toEqual(['school']);
  });
});

describe('JMdict XML 解析器', () => {
  const fixture = [
    '<JMdict>',
    '<entry><ent_seq>1000110</ent_seq><k_ele><keb>学生</keb></k_ele><r_ele><reb>がくせい</reb></r_ele><sense><pos>&n;</pos><gloss>student</gloss><gloss>pupil</gloss></sense></entry>',
    '<entry><ent_seq>1000120</ent_seq><r_ele><reb>ひらがな</reb></r_ele><sense><pos>&n;</pos><gloss>hiragana</gloss><gloss xml:lang="fre">hiragana (fr)</gloss></sense></entry>',
    '<entry><ent_seq>1000130</ent_seq><k_ele><keb>食べる</keb></k_ele><r_ele><reb>たべる</reb></r_ele><sense><pos>&v1;</pos><gloss>to eat</gloss></sense><sense><pos>&v1;</pos><gloss>to live on</gloss></sense></entry>',
    '<entry><ent_seq>1000140</ent_seq><k_ele><keb>無釈義</keb></k_ele><r_ele><reb>むしゃくぎ</reb></r_ele><sense><pos>&n;</pos></sense></entry>',
    '</JMdict>',
  ].join('');

  it('汉字表记取 keb、读音取 reb、词性映射、多释义聚合', () => {
    const entries = parseJmdictXml(fixture);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.id).toBe('jmdict-1000110');
    expect(entries[0]?.headword).toBe('学生');
    expect(entries[0]?.reading).toBe('がくせい');
    expect(entries[0]?.partOfSpeech).toBe('noun');
    expect(entries[0]?.meanings).toEqual(['student', 'pupil']);
  });

  it('无 keb 时 headword 取 reb 并置空 reading；非英文 gloss 被过滤', () => {
    const entries = parseJmdictXml(fixture);
    expect(entries[1]?.headword).toBe('ひらがな');
    expect(entries[1]?.reading).toBeUndefined();
    expect(entries[1]?.meanings).toEqual(['hiragana']);
  });

  it('多 sense 聚合释义、无英文释义的 entry 被跳过', () => {
    const entries = parseJmdictXml(fixture);
    expect(entries[2]?.headword).toBe('食べる');
    expect(entries[2]?.partOfSpeech).toBe('ichidan verb');
    expect(entries[2]?.meanings).toEqual(['to eat', 'to live on']);
  });
});

describe('P3-A 词典包安装与来源追溯', () => {
  let repo: DrizzleLearnerRepository;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('未知 packageId → E_NOT_FOUND', async () => {
    const res = await installDictionaryPackage(repo.getRawDb(), 'no-such-package');
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.code).toBe('E_NOT_FOUND');
      expect(res.error.userMessage).toContain('不存在');
    }
  });

  it('JMdict 下载失败 → 不改库（dictionary_sources 仍为空，可读失败原因）', async () => {
    const res = await installDictionaryPackage(
      repo.getRawDb(),
      JMDICT_E_SOURCE_ID,
      makeFailingFetcher(503)
    );
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      expect(res.error.userMessage.length).toBeGreaterThan(0);
      expect(res.error.userMessage).not.toMatch(/at\s+\w+\.\w+|stack trace/i);
    }
    const pkgs = listDictionaryPackages(repo.getRawDb()).filter((p) => p.installed);
    expect(pkgs).toHaveLength(0);
  });

  it('下载失败 → 不改库（dictionary_sources 仍为空，可读失败原因）', async () => {
    const res = await installDictionaryPackage(
      repo.getRawDb(),
      KENGDIC_SOURCE_ID,
      makeFailingFetcher(503)
    );
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) {
      // 可读失败原因，不泄漏底层栈
      expect(res.error.userMessage.length).toBeGreaterThan(0);
      expect(res.error.userMessage).not.toMatch(/at\s+\w+\.\w+|stack trace/i);
    }
    // 库未被写入
    const pkgs = listDictionaryPackages(repo.getRawDb()).filter((p) => p.installed);
    expect(pkgs).toHaveLength(0);
  });

  it('Kengdic 安装成功 → 来源可追溯（许可证/署名/条目数），搜索可命中', async () => {
    const tsv = makeMockKengdicTsv();
    const res = await installDictionaryPackage(
      repo.getRawDb(),
      KENGDIC_SOURCE_ID,
      makeMockFetcher(tsv)
    );
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.installed).toBe(true);
      expect(res.value.language).toBe('ko');
      expect(res.value.licenseName).toBe('CC BY-SA 3.0 / LGPL 2.0');
      expect(res.value.entryCount).toBeGreaterThanOrEqual(50_000);
      expect(res.value.attribution).toContain('Joe Speigle');
    }

    // listDictionaryPackages 反映已安装状态
    const kengdicPkg = listDictionaryPackages(repo.getRawDb()).find(
      (p) => p.id === KENGDIC_SOURCE_ID
    );
    expect(kengdicPkg?.installed).toBe(true);
    expect(kengdicPkg?.entryCount).toBeGreaterThanOrEqual(50_000);

    // dictionary_sources 来源可追溯
    const sourceRow = repo
      .getRawDb()
      .query('SELECT id, license_name, license_url, attribution, entry_count FROM dictionary_sources WHERE id = ?')
      .get(KENGDIC_SOURCE_ID) as
      | {
          id?: unknown;
          license_name?: unknown;
          license_url?: unknown;
          attribution?: unknown;
          entry_count?: unknown;
        }
      | undefined;
    expect(sourceRow).toBeDefined();
    expect(sourceRow?.license_name).toBe('CC BY-SA 3.0 / LGPL 2.0');
    expect(sourceRow?.attribution).toContain('Joe Speigle');

    // 搜索可命中（开箱词包同表层并存，按来源锁定 Kengdic 行，不依赖行序）
    const searchRes = await repo.searchLocalDictionary('ko', '안녕하세요');
    expect(isOk(searchRes)).toBe(true);
    if (isOk(searchRes)) {
      expect(searchRes.value.length).toBeGreaterThan(0);
      const kengdicEntry = searchRes.value.find((e) =>
        e.licenseNote.includes('CC BY-SA')
      );
      expect(kengdicEntry?.headword).toBe('안녕하세요');
      expect(kengdicEntry?.meanings).toContain('hello');
      expect(kengdicEntry?.licenseNote).toContain('CC BY-SA 3.0');
    }
  });

  it('Kengdic 词条可收集为 FSRS 卡（下载/搜索/收集闭环）', async () => {
    const tsv = makeMockKengdicTsv();
    await installDictionaryPackage(
      repo.getRawDb(),
      KENGDIC_SOURCE_ID,
      makeMockFetcher(tsv)
    );

    // 搜索（开箱词包同表层并存，按来源锁定 Kengdic 行）
    const searchRes = await repo.searchLocalDictionary('ko', '안녕하세요');
    expect(isOk(searchRes)).toBe(true);
    if (!isOk(searchRes)) return;
    const entry = searchRes.value.find((e) => e.licenseNote.includes('CC BY-SA'))!;

    // 收集为 FSRS 卡
    const card: Flashcard = {
      id: generateId('card'),
      userId: 'student_ko_01',
      type: 'VOCABULARY',
      front: entry.headword,
      back: entry.meanings.join('; '),
      tags: ['ko', 'kengdic'],
      fsrs: {
        stability: 2.5,
        difficulty: 4.8,
        reps: 0,
        lapses: 0,
        dueAt: new Date().toISOString(),
        state: 'NEW',
      },
    };
    const saveRes = await repo.saveCard(card);
    expect(isOk(saveRes)).toBe(true);

    // 卡片已写入 flashcards 表（直接查 DB，避免 resolveActiveLanguage 复杂度）
    const cardRow = repo
      .getRawDb()
      .query('SELECT id, front, back FROM flashcards WHERE id = ?')
      .get(card.id) as { id?: unknown; front?: unknown; back?: unknown } | undefined;
    expect(cardRow).toBeDefined();
    expect(cardRow?.front).toBe(entry.headword);
  });

  it('JMdict 安装成功 → 来源可追溯（许可证/署名/条目数），汉字与读音均可检索', async () => {
    const xml = makeMockJmdictXml();
    const res = await installDictionaryPackage(
      repo.getRawDb(),
      JMDICT_E_SOURCE_ID,
      makeMockGzipFetcher(xml)
    );
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.installed).toBe(true);
      expect(res.value.language).toBe('ja');
      expect(res.value.licenseName).toBe('CC BY-SA 4.0');
      expect(res.value.entryCount).toBeGreaterThanOrEqual(100_000);
      expect(res.value.attribution).toContain('Breen');
    }

    const jmdictPkg = listDictionaryPackages(repo.getRawDb()).find(
      (p) => p.id === JMDICT_E_SOURCE_ID
    );
    expect(jmdictPkg?.installed).toBe(true);
    expect(jmdictPkg?.entryCount).toBeGreaterThanOrEqual(100_000);

    const sourceRow = repo
      .getRawDb()
      .query('SELECT id, license_name, license_url, attribution, entry_count FROM dictionary_sources WHERE id = ?')
      .get(JMDICT_E_SOURCE_ID) as
      | {
          id?: unknown;
          license_name?: unknown;
          license_url?: unknown;
          attribution?: unknown;
          entry_count?: unknown;
        }
      | undefined;
    expect(sourceRow).toBeDefined();
    expect(sourceRow?.license_name).toBe('CC BY-SA 4.0');
    expect(sourceRow?.attribution).toContain('Breen');

    // 按汉字检索（课程种子中亦有“学生”，按来源过滤到 JMdict 行）
    const byKanji = await repo.searchLocalDictionary('ja', '学生');
    expect(isOk(byKanji)).toBe(true);
    if (isOk(byKanji)) {
      const jmdictEntry = byKanji.value.find((e) => e.sourceLabel.includes('JMdict'));
      expect(jmdictEntry).toBeDefined();
      expect(jmdictEntry?.headword).toBe('学生');
      expect(jmdictEntry?.reading).toBe('がくせい');
      expect(jmdictEntry?.meanings).toContain('student');
      expect(jmdictEntry?.licenseNote).toContain('CC BY-SA 4.0');
    }

    // 按假名读音检索
    const byReading = await repo.searchLocalDictionary('ja', 'がくせい');
    expect(isOk(byReading)).toBe(true);
    if (isOk(byReading)) {
      const jmdictEntry = byReading.value.find((e) => e.sourceLabel.includes('JMdict'));
      expect(jmdictEntry).toBeDefined();
      expect(jmdictEntry?.headword).toBe('学生');
    }
  });

  it('JMdict 词条可收集为 FSRS 卡（下载/搜索/收集闭环）', async () => {
    const xml = makeMockJmdictXml();
    await installDictionaryPackage(
      repo.getRawDb(),
      JMDICT_E_SOURCE_ID,
      makeMockGzipFetcher(xml)
    );

    const searchRes = await repo.searchLocalDictionary('ja', '学生');
    expect(isOk(searchRes)).toBe(true);
    if (!isOk(searchRes)) return;
    // 课程种子中亦有“学生”，取 JMdict 来源行
    const entry = searchRes.value.find((e) => e.sourceLabel.includes('JMdict'));
    expect(entry).toBeDefined();
    if (!entry) return;

    const card: Flashcard = {
      id: generateId('card'),
      userId: 'student_ja_01',
      type: 'VOCABULARY',
      front: entry.headword,
      back: entry.meanings.join('; '),
      tags: ['ja', 'jmdict'],
      fsrs: {
        stability: 2.5,
        difficulty: 4.8,
        reps: 0,
        lapses: 0,
        dueAt: new Date().toISOString(),
        state: 'NEW',
      },
    };
    const saveRes = await repo.saveCard(card);
    expect(isOk(saveRes)).toBe(true);

    const cardRow = repo
      .getRawDb()
      .query('SELECT id, front, back FROM flashcards WHERE id = ?')
      .get(card.id) as { id?: unknown; front?: unknown; back?: unknown } | undefined;
    expect(cardRow).toBeDefined();
    expect(cardRow?.front).toBe('学生');
  });
});
