import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  generateId,
} from '@study-studio/shared';
import {
  extractMediaRefs,
  type ParsedApkg,
} from '@study-studio/flashcard-integrations';

/**
 * M7-13 自 Gateway `flashcards/application/apkg-import.ts` 迁入导入编排
 * （循环/计数/裁剪/去重逻辑逐行一致；落库与媒体存储经 port 由调用方实现）。
 *
 * 已解析 APKG 笔记 → 导入结果：语种校验、牌组过滤、条数截断、HTML 清理、
 * 空正面跳过、同批与既有去重、标签与 NEW FSRS 组装、媒体引用统计与入库。
 * 不臆造媒体或卡片数据；时钟（now）由调用方传入。
 */

const DEFAULT_MAX_NOTES = 5000;

export interface ImportParsedApkgNotesOptions {
  userId: string;
  /** 导入语种（运行时校验 ja/en/ko，不可猜）。 */
  language: string;
  deckNames?: string[] | undefined;
  maxNotes?: number | undefined;
  /** 媒体根目录覆盖（透传给存储 port；缺省用户媒体库）。 */
  mediaRoot?: string | undefined;
  /** 卡片创建时间（调用方时钟；写入 NEW FSRS 的 dueAt）。 */
  now: string;
}

export interface ApkgImportNotesResult {
  created: number;
  skippedDuplicate: number;
  skippedEmpty: number;
  /** 引用了但包内无对应文件的媒体计数（有文件则入库）。 */
  mediaSkipped: number;
  /** 已写入用户媒体库的文件数（内容寻址去重）。 */
  mediaStored: number;
  decks: string[];
  truncated: boolean;
}

/** 新卡写入行（纯结构化数据；持久化方言由调用方补齐）。 */
export interface ApkgImportCardInput {
  id: string;
  userId: string;
  language: string;
  front: string;
  back: string;
  tagsJson: string;
  fsrsJson: string;
}

/** 导入编排所需的最小写能力（Gateway 用 Drizzle/媒体库实现）。 */
export interface ApkgImportPorts {
  /** 指定用户现有 front 集合（去重用；抛错由用例统一翻译）。 */
  listExistingFronts(userId: string): Promise<string[]>;
  /** 创建一张卡片（抛错由用例统一翻译）。 */
  createCard(card: ApkgImportCardInput): Promise<void>;
  /** 存储一份 APKG 媒体（失败返回 err 计入 mediaSkipped，不阻断）。 */
  storeMediaFile(input: {
    collection: string;
    filename: string;
    blob: Uint8Array;
    mediaRoot?: string | undefined;
  }): Promise<Result<void, BusinessError>>;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function importParsedApkgNotes(
  ports: ApkgImportPorts,
  parsed: ParsedApkg,
  options: ImportParsedApkgNotesOptions
): Promise<Result<ApkgImportNotesResult, BusinessError>> {
  // 无内部 try/catch：port 或内部逻辑的意外异常自然冒泡，
  // 由 Gateway importApkgNotes 的 translateToBusinessError 统一翻译。
  // 媒体 port 返回的业务失败（非抛错）仍计入 mediaSkipped，不阻断导入。
  if (options.language !== 'ja' && options.language !== 'en' && options.language !== 'ko') {
    return err(new BusinessError('E_INVALID_INPUT', '导入语种须为 ja/en/ko（决定卡片归属，不可猜）', 'VALIDATION', false));
  }
  const language = options.language;
  const maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTES;
  const deckFilter = options.deckNames && options.deckNames.length > 0 ? new Set(options.deckNames) : undefined;
  // 去重集合经 port 直查（front 无唯一约束，内存集合判定）。
  const seen = new Set<string>(await ports.listExistingFronts(options.userId));
  const now = options.now;
  let created = 0;
  let skippedDuplicate = 0;
  let skippedEmpty = 0;
  let mediaSkipped = 0;
  let mediaStored = 0;
  let truncated = false;
  const decks = new Set<string>();
  let processed = 0;
  for (const note of parsed.notes) {
    if (deckFilter && !deckFilter.has(note.deckName)) continue;
    if (processed >= maxNotes) {
      truncated = true;
      break;
    }
    processed += 1;
    const front = stripHtml(note.fields[0] ?? '');
    const back = stripHtml(note.fields.slice(1).join('\n'));
    if (!front) {
      skippedEmpty += 1;
      continue;
    }
    if (seen.has(front)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(front);
    // 媒体：包内有文件则入库（内容寻址去重），缺失只计数（卡片正文不臆造引用）。
    for (const ref of extractMediaRefs(note.fields.join('\x1f'))) {
      const blob = parsed.mediaBlobs.get(ref);
      if (!blob) {
        mediaSkipped += 1;
        continue;
      }
      const stored = await ports.storeMediaFile({
        collection: `apkg:${note.deckName}`,
        filename: ref,
        blob,
        ...(options.mediaRoot ? { mediaRoot: options.mediaRoot } : {}),
      });
      if (isOk(stored)) mediaStored += 1;
      else mediaSkipped += 1;
    }
    const tags = [`Anki 导入：${note.deckName}`, ...note.tags].slice(0, 16);
    await ports.createCard({
      id: generateId('card_apkg'),
      userId: options.userId,
      language,
      front: front.slice(0, 2000),
      back: (back || front).slice(0, 8000),
      tagsJson: JSON.stringify(tags),
      fsrsJson: JSON.stringify({ stability: 1, difficulty: 5, reps: 0, lapses: 0, dueAt: now, state: 'NEW' }),
    });
    created += 1;
    decks.add(note.deckName);
  }
  return ok({
    created,
    skippedDuplicate,
    skippedEmpty,
    mediaSkipped,
    mediaStored,
    decks: [...decks],
    truncated,
  });
}
