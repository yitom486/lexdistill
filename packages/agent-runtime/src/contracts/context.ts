export interface LearnerWeaknessDigest {
  skillId: string;
  name: string;
  proficiency: number;
}

export interface ContextFocusItem {
  kind: 'QUESTION' | 'CARD' | 'MISTAKE' | 'KANA_CELL' | 'TEXTBOOK_SPAN' | 'READING_PASSAGE' | 'SENTENCE';
  id?: string | undefined;
  surface: string;
  reading?: string | undefined;
  userAnswer?: string | undefined;
  correctAnswer?: string | undefined;
  explanation?: string | undefined;
  skillTag?: string | undefined;
  /**
   * P3-3 阅读归属（可选加法；既有消费者只读 surface/skillTag，不受影响）。
   * 服务端会对 documentId 做可见性校验，不可见即丢弃整个 focus。
   */
  documentId?: string | undefined;
  segmentId?: string | undefined;
}

export interface LearnerDigest {
  /** 记录阶段不是外部语言认证；证据缺失保持未知。 */
  recordedStage?: string;
  studyGoal?: string;
  practiceEvidence?: {
    status: 'observed' | 'unassessed'; attempts: number; correct: number;
    accuracy: number | null; observedSkillCount: number;
    skills: Array<{ skillId: string; name: string; attempts: number; correct: number; accuracy: number; lastPracticedAt?: string }>;
    limitation: string;
  };
  topWeaknesses: LearnerWeaknessDigest[];
  /** 课程路线（长期，不随每日重置；推荐理由与解锁判断共用同一份快照） */
  courseRoute?: {
    stage: string;
    nextUpTitle?: string | undefined;
    nextUpProgress?: string | undefined;
    mastered: number;
    total: number;
  } | undefined;
  dueCardsCount?: number | undefined;
  unresolvedMistakesCount?: number | undefined;
  streakDays?: number | undefined;
  recentErrorTags?: string[] | undefined;
  kanaMastery?: { hiragana: number; katakana: number } | undefined;
  hangulMastery?: { consonant: number; vowel: number; compound: number } | undefined;
  /** 今日计划尚未完成的步骤标题，供教练按序引导 */
  dailyPlanRemaining?: string[] | undefined;
}

export interface ContextSnapshot {
  targetLanguage: 'ja' | 'en' | 'ko';
  learnerLevel: string;
  locale?: 'zh-CN' | 'en' | undefined;
  ui?: {
    activeTab?: string | undefined;
    activeMode?: string | undefined;
    openTutor?: boolean | undefined;
    splitPaneRatio?: number | undefined;
  } | undefined;
  focus?: ContextFocusItem | undefined;
  learnerDigest?: LearnerDigest | undefined;
  userIntentHint?:
    | 'EXPLAIN'
    | 'GENERATE_QUIZ'
    | 'GRADE'
    | 'DRILL_KANA'
    | 'DRILL_HANGUL'
    | 'REVIEW_MISTAKES'
    | 'FREE_COACH'
    | undefined;
  constraints?: {
    allowedScripts?: Array<'hiragana' | 'katakana' | 'kanji' | 'romaji'> | undefined;
    maxQuestions?: number | undefined;
    questionTypes?: string[] | undefined;
    textbookLessonId?: string | undefined;
  } | undefined;
  // 向后兼容字段
  currentQuestion?: {
    id: string;
    content: string;
    correctAnswer: string;
    userAnswer?: string | undefined;
  } | undefined;
  topWeaknesses?: string[] | undefined;
  selectedWord?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * 内存态 PNG 附件（provider-neutral：只有字节与可读标签，无路径、无 base64、无厂商细节）。
 * 物化为本地文件是各 Adapter 的内部实现细节，不得泄漏到本契约之外。
 */
export interface AgentImageAttachment {
  /** PNG 编码字节（内存态，调用方用完即弃）。 */
  png: Uint8Array;
  /** 调用方可读标签（仅定位，如目录页码；不含正文与用户信息）。 */
  label?: string | undefined;
}

export interface AgentInput {
  message: string;
  contextSnapshot?: ContextSnapshot | undefined;
  /**
   * 内存态 PNG 附件（Gateway 已知事实，非 Tool，Agent 不得反向读取）。
   * 只许透传原始字节：禁止 base64 化后塞进快照 / metadata / prompt / 数据库；
   * 临时物化只许在支持图片的 Adapter 内进行，且限于本轮生命周期。
   */
  attachments?: AgentImageAttachment[] | undefined;
  /** 本轮覆盖：模型 / 思考等级 / 审批策略 / 协作模式（由 Adapter 映射到引擎原生字段） */
  turnOptions?:
    | {
        model?: string | undefined;
        effort?: string | undefined;
        approvalPolicy?: string | undefined;
        /** collaborationMode.mode：default | plan */
        collaborationMode?: string | undefined;
      }
    | undefined;
}

