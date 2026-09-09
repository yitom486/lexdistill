import type { AgentAdapter } from '@study-studio/agent-core';
import {
  BusinessError,
  err,
  generateId,
  isOk,
  logger,
  ok,
  translateToBusinessError,
  type Result,
} from '@study-studio/shared';
import {
  parseTextbookAST,
  WsEventTypes,
  type DocumentItem,
  type EnrichJobFailedLesson,
  type EnrichJobSnapshot,
  type TextbookAST,
  type WsEnvelope,
} from '@study-studio/protocol';
import { enrichCancelledError, enrichLessonVocab } from './vocab-enrich.js';

/** 课本语种（JA/EN/KO）→ 用户轨道语种（ja/en/ko）；未知回 null（AST 照存，草稿跳过）。 */
export function toTrackLanguage(bookLanguage: unknown): 'ja' | 'en' | 'ko' | null {
  if (bookLanguage === 'JA') return 'ja';
  if (bookLanguage === 'EN') return 'en';
  if (bookLanguage === 'KO') return 'ko';
  return null;
}

/** 运行器依赖：只取用到的仓储面（结构化类型，便于单测注入假仓储）。 */
export interface EnrichJobRepo {
  getDocumentById(id: string): Promise<Result<DocumentItem | null, BusinessError>>;
  saveDocument(doc: DocumentItem): Promise<Result<DocumentItem, BusinessError>>;
  shredDocument(
    documentId: string,
    book: TextbookAST
  ): Promise<Result<{ lessons: number; vocab: number; lines: number; mappedEntries: number; unmapped: number }, BusinessError>>;
  proposeCardDrafts(
    inputs: Array<{
      userId: string;
      language: 'ja' | 'en' | 'ko';
      headword: string;
      meanings: string[];
      source: 'ai-enrich';
      sourceRef: string;
      reading?: string;
      partOfSpeech?: string;
    }>
  ): Promise<Result<unknown[], BusinessError>>;
}

export interface EnrichJobRunnerDeps {
  repo: EnrichJobRepo;
  adapter: AgentAdapter | undefined;
  /** 向发起会话推送 WS 事件；无会话（轮询模式）时传空，任务照跑 */
  emitToSession: (sessionId: string, type: string, payload: unknown) => void;
}

export interface StartEnrichJobInput {
  userId: string;
  documentId: string;
  lessonIds?: string[];
  /** 发起方的 WS 会话（有则推送 import.enrich.*，无则只靠 GET 轮询） */
  sessionId?: string;
}

interface RunningJob {
  snapshot: EnrichJobSnapshot;
  controller: AbortController;
  /** 同一文档串行：新任务排队等旧任务收尾，避免双写 AST */
  promise: Promise<void>;
}

/**
 * 整本 enrich 后台任务注册表（进程内）。
 *
 * - start 立即返回 jobId，后台逐课跑：抽取→saveDocument→shred→草稿，课课落袋；
 * - 单课失败只记 failed[] 不中断整本（方言手气问题靠“重试失败”按钮另起任务补）；
 * - 同一文档已有 running 任务时直接返回旧 jobId（防双击开双任务）；
 * - cancel 是课间即停：在途一课收尾后停，已落库的不回滚；
 * - 网关重启会丢 running 任务（内存态），但已落库的课都在，新任务自动跳过有词课＝天然续跑。
 */
export class EnrichJobRegistry {
  private readonly jobs = new Map<string, RunningJob>();

  public start(deps: EnrichJobRunnerDeps, input: StartEnrichJobInput): Result<EnrichJobSnapshot, BusinessError> {
    for (const job of this.jobs.values()) {
      if (
        job.snapshot.documentId === input.documentId &&
        job.snapshot.userId === input.userId &&
        job.snapshot.status === 'running'
      ) {
        return ok({ ...job.snapshot, failed: [...job.snapshot.failed] });
      }
    }
    const jobId = generateId('enrichjob');
    const now = new Date().toISOString();
    const snapshot: EnrichJobSnapshot = {
      jobId,
      userId: input.userId,
      documentId: input.documentId,
      status: 'running',
      totalLessons: 0,
      doneLessons: 0,
      vocabularies: 0,
      grammarPoints: 0,
      dropped: 0,
      failed: [],
      startedAt: now,
    };
    const controller = new AbortController();
    const running: RunningJob = {
      snapshot,
      controller,
      promise: this.run(deps, snapshot, controller.signal, input),
    };
    this.jobs.set(jobId, running);
    void running.promise.catch(() => {});
    return ok({ ...snapshot, failed: [] });
  }

  public get(jobId: string): EnrichJobSnapshot | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { ...job.snapshot, failed: [...job.snapshot.failed] };
  }

  public cancel(jobId: string): Result<EnrichJobSnapshot, BusinessError> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return err(new BusinessError('E_NOT_FOUND', '未找到指定的抽取任务', 'LEARNER_STATE'));
    }
    if (job.snapshot.status !== 'running') return ok(this.get(jobId)!);
    job.controller.abort();
    return ok(this.get(jobId)!);
  }

  private emit(deps: EnrichJobRunnerDeps, sessionId: string | undefined, snapshot: EnrichJobSnapshot): void {
    const terminal =
      snapshot.status === 'done'
        ? WsEventTypes.IMPORT_ENRICH_COMPLETED
        : snapshot.status === 'running'
          ? WsEventTypes.IMPORT_ENRICH_PROGRESS
          : WsEventTypes.IMPORT_ENRICH_FAILED;
    const payload: EnrichJobSnapshot = { ...snapshot, failed: [...snapshot.failed] };
    if (sessionId) {
      try {
        deps.emitToSession(sessionId, terminal, payload);
      } catch (e) {
        logger.warn('[enrich-job] WS 推送失败（轮询可兜底）', {
          jobId: snapshot.jobId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (snapshot.status === 'running') {
      logger.info('[enrich-job] 进度', {
        jobId: snapshot.jobId,
        done: `${snapshot.doneLessons}/${snapshot.totalLessons}`,
        current: snapshot.currentLessonTitle ?? '',
      });
    }
  }

  private async run(
    deps: EnrichJobRunnerDeps,
    snapshot: EnrichJobSnapshot,
    signal: AbortSignal,
    input: StartEnrichJobInput
  ): Promise<void> {
    const fail = (message: string): void => {
      snapshot.status = 'failed';
      snapshot.error = message;
      snapshot.finishedAt = new Date().toISOString();
      delete snapshot.currentLessonId;
      delete snapshot.currentLessonTitle;
      logger.warn('[enrich-job] 任务失败', { jobId: snapshot.jobId, message });
      this.emit(deps, input.sessionId, snapshot);
    };
    try {
      const got = await deps.repo.getDocumentById(input.documentId);
      if (!isOk(got)) {
        fail(got.error.userMessage);
        return;
      }
      const doc = got.value;
      if (!doc || doc.userId !== input.userId) {
        fail('未找到指定的教材或文档');
        return;
      }
      if (!doc.astJson) {
        fail('该文档没有结构化课文，无法抽生词');
        return;
      }
      let astRaw: unknown;
      try {
        astRaw = JSON.parse(doc.astJson);
      } catch {
        fail('该文档课文结构已损坏，无法抽生词');
        return;
      }
      const parsed = parseTextbookAST(astRaw);
      if (!parsed.ok) {
        fail(parsed.error.userMessage);
        return;
      }
      // 只抽尚无生词的课：天然续跑（取消/失败后重开任务自动跳过已完成课）。
      const targets = parsed.value.lessons.filter(
        (l) => (!input.lessonIds || input.lessonIds.includes(l.id)) && l.vocabularies.length === 0
      );
      if (targets.length === 0) {
        fail('所选课次均已有生词，无需重复抽取');
        return;
      }
      snapshot.totalLessons = targets.length;
      const lessons = [...parsed.value.lessons];
      let book: TextbookAST = { ...parsed.value, lessons };
      const trackLanguage = toTrackLanguage(parsed.value.language);

      for (const target of targets) {
        if (signal.aborted) {
          await this.persist(deps, doc, book);
          snapshot.status = 'cancelled';
          snapshot.finishedAt = new Date().toISOString();
          delete snapshot.currentLessonId;
          delete snapshot.currentLessonTitle;
          this.emit(deps, input.sessionId, snapshot);
          return;
        }
        snapshot.currentLessonId = target.id;
        snapshot.currentLessonTitle = target.title;
        this.emit(deps, input.sessionId, snapshot);

        const res = await enrichLessonVocab(deps.adapter, {
          lessonId: target.id,
          lessonTitle: target.title,
          language: parsed.value.language,
          dialogueTexts: target.dialogues.map((d) => `${d.speaker}：${d.japanese}`),
          signal,
        });
        if (!res.ok) {
          if (res.error.code === 'E_ENRICH_CANCELLED') {
            await this.persist(deps, doc, book);
            snapshot.status = 'cancelled';
            snapshot.finishedAt = new Date().toISOString();
            delete snapshot.currentLessonId;
            delete snapshot.currentLessonTitle;
            this.emit(deps, input.sessionId, snapshot);
            return;
          }
          const failedLesson: EnrichJobFailedLesson = {
            lessonId: target.id,
            lessonTitle: target.title,
            error: res.error.userMessage,
          };
          snapshot.failed.push(failedLesson);
          snapshot.doneLessons += 1;
          delete snapshot.currentLessonId;
          delete snapshot.currentLessonTitle;
          logger.warn('[enrich-job] 单课失败，继续下一课', {
            jobId: snapshot.jobId,
            lessonId: target.id,
            code: res.error.code,
          });
          this.emit(deps, input.sessionId, snapshot);
          continue;
        }
        const idx = lessons.findIndex((l) => l.id === target.id);
        if (idx >= 0 && lessons[idx]) {
          lessons[idx] = {
            ...lessons[idx]!,
            vocabularies: res.value.vocabularies,
            grammarPoints: res.value.grammarPoints,
          };
        }
        book = { ...parsed.value, lessons };
        snapshot.vocabularies += res.value.vocabularies.length;
        snapshot.grammarPoints += res.value.grammarPoints.length;
        snapshot.dropped += res.value.dropped;
        snapshot.doneLessons += 1;
        // 逐课落库：save + shred + 草稿，课课落袋（崩了也不丢已完成的课）。
        const persisted = await this.persistLesson(deps, input, doc, book, target.id, target.title, res.value.vocabularies, trackLanguage);
        if (!persisted.ok) {
          const failedLesson: EnrichJobFailedLesson = {
            lessonId: target.id,
            lessonTitle: target.title,
            error: persisted.error.userMessage,
          };
          snapshot.failed.push(failedLesson);
        }
        delete snapshot.currentLessonId;
        delete snapshot.currentLessonTitle;
        this.emit(deps, input.sessionId, snapshot);
      }
      snapshot.status = 'done';
      snapshot.finishedAt = new Date().toISOString();
      logger.info('[enrich-job] 整本完成', {
        jobId: snapshot.jobId,
        done: `${snapshot.doneLessons}/${snapshot.totalLessons}`,
        failed: snapshot.failed.length,
      });
      this.emit(deps, input.sessionId, snapshot);
    } catch (e) {
      const biz = translateToBusinessError(e, { category: 'AGENT_RUNTIME', action: 'enrichJobRun' });
      fail(biz.userMessage);
    }
  }

  /** 整本 AST 写回 + shred（取消收尾 / 失败兜底用，不抛）。 */
  private async persist(deps: EnrichJobRunnerDeps, doc: DocumentItem, book: TextbookAST): Promise<void> {
    const saved = await deps.repo.saveDocument({
      ...doc,
      astJson: JSON.stringify(book),
      updatedAt: new Date().toISOString(),
    });
    if (!isOk(saved)) {
      logger.warn('[enrich-job] 取消收尾写库失败', { code: saved.error.code });
      return;
    }
    const shredded = await deps.repo.shredDocument(saved.value.id, book);
    if (!isOk(shredded)) {
      logger.warn('[enrich-job] 取消收尾 shred 失败', { code: shredded.error.code });
    }
  }

  /** 单课落库三件套：save → shred → 草稿；失败返回用户可读原因（记 failed，不中断）。 */
  private async persistLesson(
    deps: EnrichJobRunnerDeps,
    input: StartEnrichJobInput,
    doc: DocumentItem,
    book: TextbookAST,
    lessonId: string,
    lessonTitle: string,
    vocabularies: TextbookAST['lessons'][number]['vocabularies'],
    trackLanguage: 'ja' | 'en' | 'ko' | null
  ): Promise<Result<void, BusinessError>> {
    const saved = await deps.repo.saveDocument({
      ...doc,
      astJson: JSON.stringify(book),
      updatedAt: new Date().toISOString(),
    });
    if (!isOk(saved)) return err(saved.error);
    const shredded = await deps.repo.shredDocument(saved.value.id, book);
    if (!isOk(shredded)) {
      logger.warn('[enrich-job] 单课 shred 失败（AST 已存，下次回填）', {
        jobId: lessonId,
        code: shredded.error.code,
      });
    }
    if (trackLanguage && vocabularies.length > 0) {
      const proposed = await deps.repo.proposeCardDrafts(
        vocabularies.map((v) => ({
          userId: input.userId,
          language: trackLanguage,
          headword: v.kanji,
          meanings: [v.chinese],
          source: 'ai-enrich' as const,
          sourceRef: `${input.documentId}/${lessonId}`,
          ...(v.kana ? { reading: v.kana } : {}),
          ...(v.pos ? { partOfSpeech: v.pos } : {}),
        }))
      );
      if (!isOk(proposed)) {
        logger.warn('[enrich-job] 单课草稿提议失败（课文已存）', {
          lessonId,
          code: proposed.error.code,
        });
      }
    }
    logger.debug('[enrich-job] 单课落库', { lessonId, lessonTitle });
    return ok(undefined);
  }
}

/** 供单测：取消错误的 code 断言口径统一 */
export { enrichCancelledError };

/** WS 信封组装口（GatewayServer.emitToSession 复用，保持信封版本一致） */
export function buildEnrichWsEnvelope(
  sessionId: string,
  type: string,
  payload: EnrichJobSnapshot
): WsEnvelope {
  return {
    version: '1.0',
    id: generateId('enrichjob'),
    sessionId,
    type: type as (typeof WsEventTypes)[keyof typeof WsEventTypes],
    payload,
    timestamp: Date.now(),
  };
}
