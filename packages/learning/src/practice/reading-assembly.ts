import { isOk, type Result, type BusinessError } from '@study-studio/shared';
import type {
  GeneratedQuestion,
  PracticeBlockSpec,
  ReadingPassageSet,
} from '@study-studio/protocol';

/**
 * M7-17 自 Gateway `practice/application/practice-assembly.ts` 迁入
 * （选篇与映射规则逐行一致）。
 *
 * READING 块从最近一篇阅读套题装配（篇目随题携带，Runner 渲染可折叠面板）。
 * 选篇看难度：取最近一篇“档位内”（set.difficulty ≤ tier 上限）且有题的篇目；
 * 超纲篇目不硬上（由调用方回退链处理）。无可用套题时返回空数组。
 * 纯逻辑 + 最小 port：不读时钟、不触存储/网络；不依赖 Gateway、learner-core、
 * SQLite、Drizzle、Agent、Web。
 */

/** 阅读篇目查询语言（协议层大写码；小写映射由用例负责）。 */
export type ReadingSetLanguage = 'JA' | 'EN' | 'KO';

/** 阅读装配所需的最小能力（Gateway 用篇目仓储 + 学习门控实现）。 */
export interface ReadingQuestionPorts {
  /** 查询指定用户/语种的阅读篇目集合（失败返回 err，用例回空数组）。 */
  listReadingSets(input: {
    userId: string;
    language: ReadingSetLanguage;
  }): Promise<Result<ReadingPassageSet[], BusinessError>>;
  /** 当前用户该语种的 tier 上限（抛错由用例回退为 5）。 */
  getTierCap(): Promise<number>;
}

export async function buildReadingQuestions(
  ports: ReadingQuestionPorts,
  userId: string,
  block: PracticeBlockSpec,
  language: 'en' | 'ja' | 'ko'
): Promise<GeneratedQuestion[]> {
  const langUpper: ReadingSetLanguage =
    language === 'ja' ? 'JA' : language === 'ko' ? 'KO' : 'EN';
  const setsRes = await ports.listReadingSets({ userId, language: langUpper });
  if (!isOk(setsRes)) return [];
  let cap = 5;
  try {
    cap = await ports.getTierCap();
  } catch {
    cap = 5;
  }
  const set = (setsRes.value ?? []).find((s) => s.questions.length > 0 && s.difficulty <= cap);
  if (!set) return [];
  return set.questions.slice(0, block.count).map((rq) => ({
    id: `read_${rq.id}`,
    type: 'MULTIPLE_CHOICE' as const,
    prompt: rq.prompt,
    content: '',
    options: rq.options.map((o) => `${o.key}. ${o.text}`),
    correctAnswer: rq.correctAnswer,
    explanation: rq.explanation,
    testedSkillId: `${language === 'ja' ? 'jp' : language}.reading.comprehension`,
    difficultyTier: set.difficulty,
    reading: { setId: set.id, title: set.title, body: set.body },
  }));
}
