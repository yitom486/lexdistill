/**
 * 回合 Tool 子集选择（纯函数，可单测）。
 *
 * 背景：注册表已有 24 个 Tool，但 Turn 一直写死老 9 个——新 Tool（错题/抽认/Anki/草稿/相遇）
 * 注册了也到不了 Codex。本模块按意图 + 提示词决定每回合注入的子集。
 *
 * 策略（token 预算与误写双控）：
 * - READ 类按意图给（查词/进度/错题读/到期卡/渲染预览便宜且只读）；
 * - WRITE 类必须提示词明示（收藏/攻克/推送），意图本身不开写权限，防模型刷写；
 * - 返回 Tool 名（registry.get 解析，缺失静默跳过）；调用方在建会话时传入。
 * 注意：Codex thread 按 lane 复用，子集只在建新会话时生效，老会话保持原集合。
 */

export interface TurnToolsInput {
  intent?: string | undefined;
  userPrompt: string;
}

/** 存量基线（与旧写死列表一致，行为不变）。 */
const BASE_TOOLS = [
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

const READ_BY_INTENT: Record<string, string[]> = {
  FREE_COACH: ['mistakes.list', 'flashcards.due', 'flashcards.render', 'learning.encounters'],
  EXPLAIN: ['mistakes.list', 'flashcards.render'],
  GENERATE_QUIZ: ['mistakes.list'],
  GRADE: ['mistakes.list'],
  REVIEW_MISTAKES: ['mistakes.list'],
};

const WRITE_BY_HINT: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /收藏|加入生词|生词本|记住这个词/, tools: ['flashcards.collect'] },
  { pattern: /草稿|待确认|整理成卡|做成卡片/, tools: ['flashcards.drafts_list', 'flashcards.draft_propose'] },
  { pattern: /接受|确认入库|草稿.*入库|入库.*草稿/, tools: ['flashcards.draft_accept'] },
  { pattern: /不要|丢弃|删掉.*草稿|草稿.*删/, tools: ['flashcards.draft_dismiss'] },
  { pattern: /攻克|解决这道|掌握了|我会了|标为已会/, tools: ['mistakes.resolve'] },
  { pattern: /anki|Anki|推送/, tools: ['flashcards.anki_push', 'flashcards.render'] },
  { pattern: /模板|卡片样式|正面|背面/, tools: ['flashcards.render'] },
  { pattern: /导入|牌组|apkg|APKG/, tools: ['flashcards.apkg_analyze'] },
];

const READ_BY_HINT: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /复习|到期|今日.*练|抽查/, tools: ['flashcards.due'] },
  { pattern: /错题|错了|回炉|薄弱/, tools: ['mistakes.list'] },
  { pattern: /查词|什么意思|怎么读/, tools: ['dictionary.lookup'] },
  { pattern: /见过|眼熟|老是忘|总见到|还没记/, tools: ['learning.encounters'] },
];

export function selectTurnTools(input: TurnToolsInput): string[] {
  const prompt = input.userPrompt || '';
  const intent = input.intent || '';
  const picked: string[] = [...BASE_TOOLS];
  const push = (names: string[]) => {
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
