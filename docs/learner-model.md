# LexDistill - 学习者领域模型规格说明书 (Learner Model Specification)

> **文档版本**：v1.0  
> **所属包定义**：`packages/learner-core`  
> **核心原则**：学习者状态与错题资产是系统的第一公民，具有独立生命周期，严禁依附于大模型上下文。

---

## 一、用户与语言能力档案 (User & LanguageProfile)

```typescript
export interface UserProfile {
  id: string;                      // 用户全局唯一 ID
  displayName: string;
  activeLanguage: 'ja' | 'en';     // 当前主修外语
  languageProfiles: Record<'ja' | 'en', LanguageProfile>;
  createdAt: string;
}

export interface LanguageProfile {
  targetLanguage: 'ja' | 'en';
  overallLevel: string;            // 日语: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'; 英语: 'A1' | 'A2' | 'B1' | 'B2' | 'C1'
  studyStreakDays: number;         // 连续学习天数
  totalExercisesCompleted: number; // 总做题数
  totalCardsReviewed: number;      // 总复习卡片数
  dailyGoalMinutes: number;        // 每日目标时长
}
```

---

## 二、多维能力画像与优势/缺陷量化 (Skill Profile)

```typescript
export type SkillDimension = 
  | 'VOCABULARY'          // 词汇广度、释义精准度与辨析
  | 'GRAMMAR'             // 语法规则、句式变形与接续
  | 'LISTENING'           // 听辨音准、语速适应与连音识别
  | 'NUANCE_PRAGMATIC'    // 语境恰当度、敬语体与地道表达
  | 'READING';            // 长难句解析与快速阅读

export interface SkillMetric {
  id: string;                      // 知识点标识 (如 'jp.particle.ni_vs_de')
  dimension: SkillDimension;
  name: string;                    // 如 '助词「に」与「で」的场所功能区分'
  proficiency: number;             // 熟练度得分 (0.00 ~ 1.00)
  totalAttempts: number;           // 针对此技能点的历史作答总数
  correctAttempts: number;         // 正确作答次数
  consecutiveErrors: number;       // 最近连续出错次数
  status: 'STRENGTH' | 'NORMAL' | 'WEAKNESS'; // 动态归类
  lastPracticedAt?: string;
}
```

### 2.1 优势与薄弱项量化判定算法
1. **判定为相对优势 (`STRENGTH`) 的条件**：
   - `proficiency >= 0.85` 且 `totalAttempts >= 5` 且 `consecutiveErrors === 0`。
   - 意味着用户在此技能点上经过多次检验，掌握扎实，出题时降低其出现频度。
2. **判定为当前薄弱项 (`WEAKNESS`) 的条件**：
   - `proficiency < 0.60` 或者 `consecutiveErrors >= 2`。
   - 只要连续做错 2 次，系统立即将其打上薄弱标签，并由 `Context Builder` 优先注入出题引擎实施针对性巩固。

---

## 三、学习卡片与 FSRS 记忆衰减调度

卡片不仅用于背单词，还支持语法和混淆句型复习：

```typescript
export interface FlashcardItem {
  id: string;
  userId: string;
  type: 'VOCABULARY' | 'GRAMMAR' | 'CONFUSION_PAIR';
  front: string;                   // 正面提示 (词汇、句型骨架)
  back: string;                    // 背面解析 (释义、接续公式、例句)
  phonetic?: string;               // 假名注音或音标
  audioUrl?: string;               // 示范发音
  tags: string[];                  // 技能与考点标签
  
  // FSRS (Free Spaced Repetition Scheduler) 记忆状态
  fsrs: {
    stability: number;             // 记忆稳定度 (S)
    difficulty: number;            // 难度因子 (D, 1~10)
    reps: number;                  // 总复习次数
    lapses: number;                // 遗忘重学次数
    lastReviewedAt?: string;       // 上次复习时间戳
    dueAt: string;                 // 下次应复习时间戳
    state: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  };
}
```

---

## 四、做题记录与全功能错题本 (Mistake Notebook)

```typescript
export interface QuizAttemptRecord {
  id: string;
  userId: string;
  questionId: string;
  questionContent: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  score: number;
  timeSpentMs: number;
  testedSkillId: string;
  createdAt: string;
}

export interface MistakeRecord {
  id: string;
  userId: string;
  questionId: string;
  questionSnapshot: {
    prompt: string;
    content: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
  };
  userLastAnswer: string;
  
  // 错因归因分类
  errorCategory: 
    | 'PARTICLE'           // 助词/介词混淆
    | 'TENSE'              // 时态错位
    | 'WORD_CHOICE'        // 近义词搭配不当
    | 'SYNTAX'             // 句法倒装或接续错误
    | 'COLLOCATION'        // 固定短语误用
    | 'PRONUNCIATION'      // 听音辨析失误
    | 'OTHER';

  aiDiagnosis: string;             // AI 给出的深度错因剖析
  motherTongueInterference?: string;// 母语负迁移原因提示
  
  // 巩固与攻克状态
  retryCount: number;              // 错题重做次数
  consecutiveCorrect: number;      // 重做连续答对次数
  isResolved: boolean;             // 是否彻底攻克 (consecutiveCorrect >= 2 时置为 true)
  recordedAt: string;
  lastRetriedAt?: string;
}
```

---

## 五、持久化数据仓库接口 (`LearnerRepository`)

为保证系统在不同运行环境（桌面 SQLite、云端 PostgreSQL、开发期内存 Mock）无缝切换，所有数据交互通过 Repository 抽象：

```typescript
export interface LearnerRepository {
  // 画像与指标
  getUserProfile(userId: string): Promise<UserProfile | null>;
  saveUserProfile(profile: UserProfile): Promise<void>;
  getSkillMetrics(userId: string): Promise<SkillMetric[]>;
  updateSkillMetric(userId: string, metric: Partial<SkillMetric> & { id: string }): Promise<void>;

  // 卡片
  getDueCards(userId: string, limit: number): Promise<FlashcardItem[]>;
  saveCard(card: FlashcardItem): Promise<void>;

  // 做题与错题
  recordQuizAttempt(attempt: QuizAttemptRecord): Promise<void>;
  saveMistake(mistake: MistakeRecord): Promise<void>;
  getMistakes(userId: string, filter?: { resolved?: boolean; dimension?: SkillDimension }): Promise<MistakeEntry[]>;
  updateMistakeResolution(mistakeId: string, isResolved: boolean, consecutiveCorrect: number): Promise<void>;
}
```
