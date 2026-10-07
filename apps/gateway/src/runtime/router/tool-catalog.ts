/**
 * Gateway 工具中央目录：一份事实，按 agent 与会话按需取子集。
 *
 * 背景：工具实现散在各域 `registerXTools`（归属不变），但“谁能拿什么”
 * 散在三处：turn-tools 的意图/正则、turn-handlers 的内联分支、
 * 各前端 `agentOptions.tools` 字面量。本文件只收敛选型，不搬实现、
 * 不碰 Registry 生命周期：
 * - Gateway 工具表（基线/意图/提示词）唯一 owner；turn-tools 只剩薄包装；
 * - 固定任务显式集（vocabulary.explain）唯一 owner，前端照单发送，网关按名解析；
 * - 教材 MCP 服务器定义住在 `modules/library/mcp/textbook-mcp-catalog.ts`
 *  （G5-R2 禁止领域反向依赖 Runtime，故 MCP 目录住领域内；两者互指）。
 *
 * 策略（沿旧 turn-tools，token 预算与误写双控）：
 * - READ 类按意图给；WRITE 类必须提示词明示，意图本身不开写权限；
 * - 固定任务命中 task 直接采用，不走关键词正则；
 * - 返回 Tool 名（registry.get 解析，缺失静默跳过）；只在建新会话时生效。
 */

/** 存量基线（与旧写死列表一致）。 */
export const BASE_TOOLS = [
  'learning.content',
  'learning.assess',
  'learning.progress',
  'learning.plan',
  'learning.curriculum',
  'learning.library',
  'dictionary.lookup',
  'ui.navigate',
  'ui.present',
] as const;

export const READ_BY_INTENT: Record<string, string[]> = {
  FREE_COACH: ['mistakes.list', 'flashcards.due', 'flashcards.render', 'learning.encounters'],
  EXPLAIN: ['mistakes.list', 'flashcards.render'],
  GENERATE_QUIZ: ['mistakes.list'],
  GRADE: ['mistakes.list'],
  REVIEW_MISTAKES: ['mistakes.list'],
};

export const WRITE_BY_HINT: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /收藏|加入生词|生词本|记住这个词/, tools: ['flashcards.collect'] },
  { pattern: /草稿|待确认|整理成卡|做成卡片/, tools: ['flashcards.drafts_list', 'flashcards.draft_propose'] },
  { pattern: /接受|确认入库|草稿.*入库|入库.*草稿/, tools: ['flashcards.draft_accept'] },
  { pattern: /不要|丢弃|删掉.*草稿|草稿.*删/, tools: ['flashcards.draft_dismiss'] },
  { pattern: /攻克|解决这道|掌握了|我会了|标为已会/, tools: ['mistakes.resolve'] },
  { pattern: /anki|Anki|推送/, tools: ['flashcards.anki_push', 'flashcards.render'] },
  { pattern: /AI讲解|生成讲解|保存讲解/, tools: ['vocabulary.learning.submit'] },
  { pattern: /模板|卡片样式|正面|背面/, tools: ['flashcards.render'] },
  { pattern: /导入|牌组|apkg|APKG/, tools: ['flashcards.apkg_analyze'] },
];

export const READ_BY_HINT: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /复习|到期|今日.*练|抽查/, tools: ['flashcards.due'] },
  { pattern: /错题|错了|回炉|薄弱/, tools: ['mistakes.list'] },
  { pattern: /查词|什么意思|怎么读/, tools: ['dictionary.lookup'] },
  { pattern: /见过|眼熟|老是忘|总见到|还没记/, tools: ['learning.encounters'] },
  { pattern: /讲透|精学|学透|AI讲解|生成讲解/, tools: ['vocabulary.learning.context'] },
];

/**
 * 词汇讲解固定任务集（canonical；`apps/web` 的 useWordTutor 照单发送，
 * 共享的 `dictionary.lookup` 即“多 agent 共用同一工具”的实例）。
 */
export const VOCABULARY_EXPLAIN_TOOLS = [
  'vocabulary.learning.context',
  'vocabulary.learning.submit',
  'dictionary.lookup',
] as const;

/** 固定任务显式集：出题任务（generation.*）由 question-generation/runner 自带隔离执行器，不进本表。 */
export const TASK_TOOL_PRESETS: Record<string, readonly string[]> = {
  'vocabulary.explain': VOCABULARY_EXPLAIN_TOOLS,
};

/** 任务 id 解析：命中返回显式集副本；未知/缺席返回 undefined（调用方回退提示词路径）。 */
export function resolveTaskTools(task?: string | undefined): string[] | undefined {
  if (!task) return undefined;
  const preset = TASK_TOOL_PRESETS[task];
  return preset ? [...preset] : undefined;
}

export interface SessionToolsInput {
  intent?: string | undefined;
  userPrompt: string;
  /** 固定任务 id：命中 TASK_TOOL_PRESETS 直接采用，不走意图/提示词。 */
  task?: string | undefined;
}

/** 单一解析入口：任务显式集优先，否则意图 + 提示词子集（与旧 selectTurnTools 同行为）。 */
export function resolveSessionTools(input: SessionToolsInput): string[] {
  const taskTools = resolveTaskTools(input.task);
  if (taskTools) return taskTools;
  const prompt = input.userPrompt || '';
  const intent = input.intent || '';
  const picked: string[] = [...BASE_TOOLS];
  const push = (names: readonly string[]) => {
    for (const name of names) {
      if (!picked.includes(name)) picked.push(name);
    }
  };
  push(READ_BY_INTENT[intent] ?? READ_BY_INTENT['FREE_COACH'] ?? []);
  for (const { pattern, tools } of READ_BY_HINT) {
    if (pattern.test(prompt)) push(tools);
  }
  // WRITE 必须明示：意图本身不开写权限
  for (const { pattern, tools } of WRITE_BY_HINT) {
    if (pattern.test(prompt)) push(tools);
  }
  return picked;
}
