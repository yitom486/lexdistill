import { resolveAgentFirstMessage, type AgentAdapter } from '@lexdistill/agent-runtime';
import { BusinessError, err, isOk, logger, ok, translateToBusinessError, type Result } from '@lexdistill/shared';
import {
  TextbookGrammarSchema,
  TextbookVocabularySchema,
  type TextbookAST,
  type TextbookGrammar,
  type TextbookVocabulary,
} from '@lexdistill/document-model';

/**
 * AI 生词/文法抽取（PDF 导入第二刀）。
 *
 * 防臆造三件套：
 * 1. 输出先过 protocol zod（TextbookVocabularySchema / TextbookGrammarSchema），非法整条丢弃并计数；
 * 2. 生词接地检查：kanji 或 kana 必须原文出现，否则丢弃（模型编的词进不了库）；
 * 3. 声调不猜：pitchAccent 非 ⓪①②③④⑤⑥ 一律记 '？'（未知就是未知）；
 * 上限：每课生词 24、文法 6；无 adapter 直接返回 E_ENRICH_NO_ADAPTER（不静默降级）。
 */

export const MAX_VOCAB_PER_LESSON = 24;
/** 文法上限 10（活用表类附赠内容也是合法文法资产，与主表同权） */
export const MAX_GRAMMAR_PER_LESSON = 10;

export interface EnrichLessonInput {
  lessonId: string;
  lessonTitle: string;
  language: 'JA' | 'EN' | 'KO';
  dialogueTexts: string[];
  /**
   * 取消信号（后台任务用）：abort 后课间即停；在途的模型轮次经
   * session.interrupt() 中断（per-session，不影响其他会话），
   * 返回 E_ENRICH_CANCELLED 而非模型错误。
   */
  signal?: AbortSignal;
  /**
   * 模型分流：抽取是结构化体力活，
   * 允许指定便宜模型 + 低 effort；不填则走网关缺省（强模型）。
   * effort 必须取目标模型的支持列表（硬塞未知档会被拒收），调用方负责选对。
   */
  model?: string;
  effort?: string;
}

export interface EnrichLessonResult {
  lessonId: string;
  vocabularies: TextbookVocabulary[];
  grammarPoints: TextbookGrammar[];
  /** 因非法/无接地被丢弃的条数（回显给用户，不藏） */
  dropped: number;
}

export const ENRICH_SYSTEM_PROMPT = [
  '你是外语教材编辑。用户给你一课的课文句（日语/英语/韩语其一），请抽出生词与核心文法，只返回 JSON。',
  '格式：{"vocabularies": [{"kanji": "词面（必须原文出现）", "kana": "注音（日文假名/英语音标/韩文罗马音）", "chinese": "简短中文释义", "pos": "词性", "pitchAccent": "声调符号", "example": {"japanese": "含该词的课文原句或短句", "chinese": "中文"}}], "grammarPoints": [{"title": "文法点", "connection": "接续", "explanation": "中文一两句", "examples": [{"japanese": "例句", "chinese": "中文"}]}]}。',
 '铁律：kanji 必须是课文里真实出现的词，绝不编考生词；不要输出 markdown 围栏之外的任何文字；',
 '键名必须用英文（vocabularies/kanji/kana/chinese/pos/pitchAccent/example，grammarPoints/title/connection/explanation/examples），中文键会被丢弃；',
 '声调不知道就写"？"，不要猜；例句优先用课文原句。',
].join('\n');

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  let candidate = cleaned;
  if (!candidate.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    candidate = cleaned.slice(start, end + 1);
  }
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const PITCH_RE = /^[⓪①②③④⑤⑥]$/;
const CIRCLED_BY_DIGIT: Record<string, string> = {
  '0': '⓪',
  '1': '①',
  '2': '②',
  '3': '③',
  '4': '④',
  '5': '⑤',
  '6': '⑥',
};

/** 声调归一化：圈号直通；阿拉伯数字映射圈号；其余一律 '？'（不猜）。 */
export function normalizePitch(raw: unknown): string {
  if (typeof raw !== 'string') return '？';
  const t = raw.trim();
  if (PITCH_RE.test(t)) return t;
  if (/^[0-6]$/.test(t)) return CIRCLED_BY_DIGIT[t] as string;
  return '？';
}

const VOCAB_KEYS = ['vocabularies', '生词', 'vocabulary', 'words', 'wordList', 'vocab'];
const GRAMMAR_KEYS = ['grammarPoints', '文法', '核心文法', '语法', '句型', 'grammar', 'grammarList'];
/** 词面键全集（形状判定用：含其一即生词形条目） */
const WORD_KEYS = [
  'kanji', '词', '词汇', '词语', '词面', '单词', 'word', 'expression', '表达', 'surface', '日语', '日文',
];
/** 文法标题键全集（含其一即文法形条目；与 normalizeGrammarItem 的 title 别名同源） */
const GRAMMAR_TITLE_KEYS = [
  'title', '句型', '句式', '文型', 'pattern', 'rule', '名称', '标题', '文法点',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function looksVocabItem(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return WORD_KEYS.some((k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0);
}

function looksGrammarItem(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return GRAMMAR_TITLE_KEYS.some((k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0);
}

/**
 * 顶层归一（形状驱动，替代键名枚举）：
 * - 数组值：按条目形状分拣（生词形/文法形各归其表；两都不像的丢弃计数上游处理）；
 * - 对象值：展一层后同样分拣（`生词: {动词: [...], 名词: [...]}` 按词性分组是实测方言）；
 * - 已知主表键优先（顺序稳定），附赠键与杂散数组随后，未知键靠形状收编。
 * 防护网没变：分拣只定去向，生词仍须原文逐字接地，编的词进不了库。
 */
export function normalizeEnrichJson(obj: Record<string, unknown>): { vocabularies: unknown; grammarPoints: unknown } {
  const vocab: unknown[] = [];
  const grammar: unknown[] = [];
  const seen = new Set<unknown>();
  const feed = (v: unknown): void => {
    if (seen.has(v)) return;
    seen.add(v);
    if (looksGrammarItem(v)) grammar.push(v);
    // 其余一切（生词形/未知形/标量）都进生词表：下游 zod+接地照样丢弃计数，
    // 可观测性不变，不静默吞（与旧版直通行为一致）。
    else vocab.push(v);
  };
  const feedArray = (arr: unknown[]): void => {
    for (const item of arr) feed(item);
  };
  const orderedKeys = [...VOCAB_KEYS, ...GRAMMAR_KEYS, ...Object.keys(obj)];
  const doneKeys = new Set<string>();
  for (const k of orderedKeys) {
    if (doneKeys.has(k)) continue;
    doneKeys.add(k);
    const v = obj[k];
    if (Array.isArray(v)) feedArray(v);
    else if (isRecord(v)) {
      // 分组对象：展一层（值是数组才收；字符串等噪声跳过）
      for (const sub of Object.values(v)) {
        if (Array.isArray(sub)) feedArray(sub);
      }
    }
  }
  return { vocabularies: vocab, grammarPoints: grammar };
}

function pickStr(src: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/**
 * 条目键别名归一（词语/读音/释义…→ kanji/kana/chinese…）。
 * 只做键名映射，不填内容：缺键即缺失（zod 必填项不过即整条丢弃）。
 */
export function normalizeVocabItem(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const kanji = pickStr(src, ['kanji', '词', '词汇', '词语', '词面', '单词', 'word', 'expression', '表达', 'surface', '日语', '日文']);
  const kana = pickStr(src, ['kana', '读音', '注音', '假名', 'かな', 'カナ', '仮名', 'reading', 'pronunciation']);
  const chinese = pickStr(src, ['chinese', 'meaning_zh', '释义', '中文', '意思', 'meaning', 'gloss']);
  const pos = pickStr(src, ['pos', 'part_of_speech', '词性', '品詞', 'partOfSpeech']);
  const pitch = pickStr(src, ['pitchAccent', '声调', '声调符号', 'pitch']);
  if (kanji !== undefined) out['kanji'] = kanji;
  // 注音缺席记空串（重点应答类短语常无注音；接地走词面，不编读音）
  if (kana !== undefined) out['kana'] = kana;
  else out['kana'] = '';
  if (chinese !== undefined) out['chinese'] = chinese;
  if (pos !== undefined) out['pos'] = pos;
  if (pitch !== undefined) out['pitchAccent'] = pitch;
  // 例句字符串 → 包成对象（中文译文缺席即空串，不编）
  const exRaw = src['example'] ?? src['例句'] ?? src['exampleSentence'];
  if (typeof exRaw === 'string') {
    out['example'] = { japanese: exRaw, chinese: '' };
  } else if (typeof exRaw === 'object' && exRaw !== null) {
    const ex = exRaw as Record<string, unknown>;
    out['example'] = {
      japanese: pickStr(ex, ['japanese', '日文', '例句日文', 'ja']) ?? '',
      chinese: pickStr(ex, ['chinese', '中文', '译文', 'zh']) ?? '',
    };
  }
  return out;
}

export function normalizeGrammarItem(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const title = pickStr(src, ['title', '句型', '句式', '文型', 'pattern', 'rule', '名称', '标题', '文法点']);
  const connection = pickStr(src, ['connection', '接续', '连接', 'formation', '结构']);
  // 含义+要点都是讲法（模型中文方言常见组合），如实拼接，不编造
  const meaningParts = [
    pickStr(src, ['含义', '讲解', '说明', '用法', 'usage_zh', 'name_zh', 'verb_group', '功能', '规则']),
    pickStr(src, ['要点']),
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (title !== undefined) out['title'] = title;
  // connection（接续）在模型中文方言里常无对应键：缺席记空串（诚实缺口），不断整条
  out['connection'] = connection ?? '';
  if (meaningParts.length > 0) out['explanation'] = meaningParts.join('\n');
  else if (out['explanation'] === undefined) out['explanation'] = '';
  const rawExamples = src['examples'] ?? src['例句'] ?? src['例子'];
  const wrapExample = (e: unknown): unknown => {
    // 模型中文方言常给纯字符串例句 → 包成对象（中文译文缺席即空串，不编）
    if (typeof e === 'string') return { japanese: e, chinese: '' };
    if (typeof e === 'object' && e !== null) {
      const ex = e as Record<string, unknown>;
      return {
        japanese: pickStr(ex, ['japanese', '日文', '例句日文', 'ja']) ?? '',
        chinese: pickStr(ex, ['chinese', '中文', '译文', 'zh']) ?? '',
      };
    }
    return e;
  };
  if (Array.isArray(rawExamples)) {
    out['examples'] = rawExamples.map(wrapExample);
  } else if (rawExamples !== undefined) {
    out['examples'] = [wrapExample(rawExamples)];
  }
  return out;
}

export function groundVocabularies(
  rawList: unknown,
  lessonText: string,
  lessonId: string
): { kept: TextbookVocabulary[]; dropped: number } {
  const kept: TextbookVocabulary[] = [];
  let dropped = 0;
  const flat = lessonText.replace(/\s+/g, '');
  const list = Array.isArray(rawList) ? rawList.slice(0, MAX_VOCAB_PER_LESSON) : [];
  for (const item of list) {
    // id 由服务端统一编制（模型给的 id 不可用），解析时剔除
    const parsed = TextbookVocabularySchema.omit({ id: true }).safeParse(normalizeVocabItem(item));
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const v = parsed.data;
    const surface = v.kanji.replace(/\s+/g, '');
    const reading = (v.kana || '').replace(/\s+/g, '');
    // 接地：词面或注音至少其一在课文出现（英语音标类注音不在原文时靠词面）。
    // 辞书形前缀 ～（如 ～さん）只用于比对时剥离，入库保留原写法。
    const groundSurface = surface.replace(/^[～〜~]/, '');
    if (
      !groundSurface ||
      (flat.indexOf(groundSurface) < 0 && (!reading || flat.indexOf(reading) < 0))
    ) {
      dropped++;
      continue;
    }
    // 例句必须包含该词（优先课文原句；模型现造句也必须带词）
    if (v.example) {
      const ex = v.example.japanese.replace(/\s+/g, '');
      if (ex.indexOf(groundSurface) < 0 && (!reading || ex.indexOf(reading) < 0)) {
        dropped++;
        continue;
      }
    }
    // 缺字段时 zod 会默认填 ⓪——缺失≠平板，未知记 '？'
    const rawHasPitch =
      typeof item === 'object' && item !== null && 'pitchAccent' in (item as Record<string, unknown>);
    kept.push({
      ...v,
      id: `${lessonId}-v${kept.length + 1}`,
      pitchAccent: rawHasPitch ? normalizePitch(v.pitchAccent) : '？',
    });
  }
  return { kept, dropped };
}

export function groundGrammarPoints(
  rawList: unknown,
  lessonId: string
): { kept: TextbookGrammar[]; dropped: number } {
  const kept: TextbookGrammar[] = [];
  let dropped = 0;
  const list = Array.isArray(rawList) ? rawList.slice(0, MAX_GRAMMAR_PER_LESSON) : [];
  for (const item of list) {
    const parsed = TextbookGrammarSchema.omit({ id: true }).safeParse(normalizeGrammarItem(item));
    if (!parsed.success) {
      dropped++;
      continue;
    }
    const g = parsed.data;
    if (g.examples.length === 0 || !g.examples[0]?.japanese.trim()) {
      dropped++;
      continue;
    }
    kept.push({ ...g, id: `${lessonId}-g${kept.length + 1}` });
  }
  return { kept, dropped };
}

export interface GroundedEnrichment {
  vocabularies: TextbookVocabulary[];
  grammarPoints: TextbookGrammar[];
  dropped: number;
}

/** 解析 + 接地；JSON 不可解析返回 null（调用方决定重试或报错）。 */
export function parseAndGround(
  text: string,
  lessonText: string,
  lessonId: string
): GroundedEnrichment | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const normalized = normalizeEnrichJson(obj);
  const vocab = groundVocabularies(normalized.vocabularies, lessonText, lessonId);
  const grammar = groundGrammarPoints(normalized.grammarPoints, lessonId);
  return {
    vocabularies: vocab.kept,
    grammarPoints: grammar.kept,
    dropped: vocab.dropped + grammar.dropped,
  };
}

const REPAIR_PROMPT =
  '格式不符合要求，请严格只返回 JSON：顶层字段名必须用英文 vocabularies / grammarPoints；' +
  '生词条目字段 kanji / kana / chinese / pos / pitchAccent / example{ japanese / chinese }；' +
  '文法条目字段 title / connection / explanation / examples[{ japanese / chinese }]。重返本课结果，不要解释。';

export function enrichCancelledError(): BusinessError {
  return new BusinessError('E_ENRICH_CANCELLED', '已取消抽取，已完成的课次均已保存', 'AGENT_RUNTIME', true);
}

export async function enrichLessonVocab(
  adapter: AgentAdapter | undefined,
  input: EnrichLessonInput
): Promise<Result<EnrichLessonResult, BusinessError>> {
  if (input.signal?.aborted) return err(enrichCancelledError());
  if (!adapter) {
    return err(
      new BusinessError('E_ENRICH_NO_ADAPTER', 'AI 抽生词需要连接模型，请确认网关已连接后重试', 'AGENT_RUNTIME')
    );
  }
  if (input.dialogueTexts.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', '本课没有课文句，无法抽生词', 'VALIDATION'));
  }
  const sessionRes = await adapter.createSession({
    sessionId: `enrich-${input.lessonId}-${Date.now()}`,
    userId: 'pdf-enrich',
    systemPrompt: ENRICH_SYSTEM_PROMPT,
    tools: [],
    // 模型分流经建会话生效（ACP 以 setConfigOption 落盘；旧 turnOptions 通道无适配器读取，已删除）。
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  });
  if (!isOk(sessionRes)) return err(sessionRes.error);
  const session = sessionRes.value;
  const signal = input.signal;
  // 取消→中断本会话的在途轮次（interrupt 是 per-session 的，
  // 只 abort 自己的控制器；finally 照常 close，会话不泄漏）。
  const onAbort = () => {
    void session.interrupt().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      void session.close().catch(() => {});
      return err(enrichCancelledError());
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const ask = async (message: string): Promise<Result<string, BusinessError>> => {
    try {
      let text = '';
      for await (const ev of session.send({ message })) {
        if (ev.type === 'TEXT_DELTA') {
          text += ev.delta;
        } else if (ev.type === 'ERROR') {
          return err(ev.error);
        } else if (ev.type === 'COMPLETED') {
          if (ev.finalOutput) text = ev.finalOutput;
          break;
        }
      }
      return ok(text);
    } catch (error) {
      return err(translateToBusinessError(error, { category: 'AGENT_RUNTIME', action: 'enrichLessonVocab' }));
    }
  };
  try {
    const numbered = input.dialogueTexts.map((t, i) => `【句${i + 1}｜${input.language}】${t}`).join('\n');
    // ACP 无 systemPrompt 通道：身份随首消息前置；其他通路走原生通道，不加料。
    const message = resolveAgentFirstMessage(
      session,
      ENRICH_SYSTEM_PROMPT,
      `课名：${input.lessonTitle}\n${numbered}\n\n请抽取本课生词与核心文法，只返回 JSON。`
    );
    const first = await ask(message);
    if (signal?.aborted) return err(enrichCancelledError());
    if (!first.ok) return err(first.error);
    const lessonText = input.dialogueTexts.join('\n');
    logger.debug('[vocab-enrich] raw output round1', {
      lessonId: input.lessonId,
      chars: first.value.length,
      head: first.value.slice(0, 600),
    });
    let grounded = parseAndGround(first.value, lessonText, input.lessonId);
    if (!grounded || grounded.vocabularies.length === 0) {
      // 生词零收成：同会话修复一次（格式跑偏是已知偶发）；仍无结果才报错，不写库。
      // 文法允许为零（模型偶发不给文法，不值得为此多花一轮）。
      logger.info('[vocab-enrich] 首轮生词零收成，同会话修复一次', { lessonId: input.lessonId });
      const second = await ask(REPAIR_PROMPT);
      if (signal?.aborted) return err(enrichCancelledError());
      if (!second.ok) return err(second.error);
      logger.debug('[vocab-enrich] raw output round2', {
        lessonId: input.lessonId,
        chars: second.value.length,
        head: second.value.slice(0, 600),
      });
      grounded = parseAndGround(second.value, lessonText, input.lessonId);
    }
    if (!grounded || grounded.vocabularies.length === 0) {
      // 空收成是运营显著事件：warn 让网关控制台可见（raw 查上面的 debug）。
      logger.warn('[vocab-enrich] empty result (no keepable vocab after repair)', {
        lessonId: input.lessonId,
        sentences: input.dialogueTexts.length,
        round1chars: first.value.length,
      });
      return err(new BusinessError('E_ENRICH_PARSE', '模型返回无法解析，未写入任何内容', 'AGENT_RUNTIME'));
    }
    logger.info('[vocab-enrich] 抽取完成', {
      lessonId: input.lessonId,
      kept: grounded.vocabularies.length + grounded.grammarPoints.length,
      dropped: grounded.dropped,
    });
    return ok({
      lessonId: input.lessonId,
      vocabularies: grounded.vocabularies,
      grammarPoints: grounded.grammarPoints,
      dropped: grounded.dropped,
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    void session.close().catch(() => {});
  }
}

/** 整本：只抽尚无生词的课（已有词的不覆盖）。 */
export interface EnrichDraftable {
  lessonId: string;
  lessonTitle: string;
  vocab: TextbookVocabulary;
}

export async function enrichBookLessons(
  adapter: AgentAdapter | undefined,
  book: TextbookAST,
  lessonIds?: string[]
): Promise<Result<{ book: TextbookAST; enrichedLessons: number; vocabularies: number; grammarPoints: number; dropped: number; draftables: EnrichDraftable[] }, BusinessError>> {
  const targets = book.lessons.filter(
    (l) => (!lessonIds || lessonIds.includes(l.id)) && l.vocabularies.length === 0
  );
  if (targets.length === 0) {
    return err(new BusinessError('E_INVALID_INPUT', '所选课次均已有生词，无需重复抽取', 'VALIDATION'));
  }
  let vocabCount = 0;
  let grammarCount = 0;
  let dropped = 0;
  const draftables: EnrichDraftable[] = [];
  const lessons = [...book.lessons];
  for (const target of targets) {
    const res = await enrichLessonVocab(adapter, {
      lessonId: target.id,
      lessonTitle: target.title,
      language: book.language,
      dialogueTexts: target.dialogues.map((d) => `${d.speaker}：${d.japanese}`),
    });
    if (!res.ok) return err(res.error);
    const idx = lessons.findIndex((l) => l.id === target.id);
    if (idx >= 0 && lessons[idx]) {
      lessons[idx] = {
        ...lessons[idx]!,
        vocabularies: res.value.vocabularies,
        grammarPoints: res.value.grammarPoints,
      };
    }
    for (const vocab of res.value.vocabularies) {
      draftables.push({ lessonId: target.id, lessonTitle: target.title, vocab });
    }
    vocabCount += res.value.vocabularies.length;
    grammarCount += res.value.grammarPoints.length;
    dropped += res.value.dropped;
  }
  return ok({
    book: { ...book, lessons },
    enrichedLessons: targets.length,
    vocabularies: vocabCount,
    grammarPoints: grammarCount,
    dropped,
    draftables,
  });
}
