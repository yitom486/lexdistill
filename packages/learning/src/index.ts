/**
 * M6-3 学习领域统一对外 facade（领域组合入口，不持有数据库连接、不新增迁移）。
 *
 * 分层说明：
 * - 本包只组合纯/版本化领域 API（review-core 排程入口、practice-core 组卷与
 *   练习规则），一律具名重导出（不用 `export *`，避免命名冲突与语义漂移）；
 * - `@study-studio/learner-core` 仍是学习者状态、Repository 与用户学习资产的
 *   唯一事实源：状态类 API 暂不经本包转出，Gateway 现有 learner-core 消费保持不动，
 *   后续迁移再按需扩展；
 * - 规范源唯一：蓝图/计划类名字只从 practice-core 出，排程只从 review-core 出，
 *   排程状态类型只从 learning-algorithms 出，
 *   绝不经 learner-core 兼容垫片转出（行为虽一致，但垫片只是过渡）。
 * - M7-10 起含快照组装用例（最小读取 port + 确定性映射；时钟与异常翻译归调用方）。
 */

/** 版本化复习排程（FSRS v1，纯排程不写库）。 */
export { scheduleFsrsReviewV1, type FsrsReviewInput } from '@study-studio/review-core';

/** 排程调用所需的公共状态类型（规范源 learning-algorithms）。 */
export { type FsrsState } from '@study-studio/learning-algorithms';

/** 阶段测评蓝图与晋级判定（纯规则）。 */
export {
  ASSESSMENT_BLUEPRINT_VERSION,
  blueprintFor,
  attributeGroup,
  evaluateExamVerdict,
  type BlueprintGroup,
  type AssessmentBlueprint,
  type GroupSubscore,
  type ExamVerdict,
} from '@study-studio/practice-core';

/** 练习计划与客观题规则（纯规则）。 */
export {
  SUBJECTIVE_BATCH_MAX_COUNT,
  SUBJECTIVE_BATCH_MAX_CHARS,
  isPracticeBlockKind,
  isGradingMode,
  validateBlockSpec,
  validatePracticePlanTemplate,
  validatePracticePlanSchedule,
  isTemplateDueOn,
  freezeRunFromTemplate,
  isRunComplete,
  parsePracticeBlockSpec,
  parsePracticeBlockSpecs,
} from '@study-studio/practice-core';

/** 练习运行本地汇总（规范源 practice-core，只转出不复制实现）。 */
export {
  buildLocalRunSummary,
  type RunSummaryReport,
} from '@study-studio/practice-core';

/** 客观题权威判题（规范源 practice-core，只转出不复制实现）。 */
export {
  gradeObjectiveAnswer,
  type ObjectiveQuestionLike,
} from '@study-studio/practice-core';

/**
 * 学习进度纯计算（规范源 learner-core，本包只转出不复制实现）。
 * learner-core 仍是学习者状态与持久化事实源；状态、Repository 与数据库契约
 * 不经本包转出。
 */
export {
  summarizeLearningEvidence,
  recordSkillAttempt,
  buildProfileSnapshot,
  type SkillMetric,
  type TargetLanguage,
  type LearnerProfileSnapshot,
} from '@study-studio/learner-core';

/** 学习分析快照组装（最小读取 port + 确定性映射；不读时钟）。 */
export {
  buildAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisSnapshotPorts,
  type AssembleSnapshotInput,
} from './analysis-snapshot.js';
