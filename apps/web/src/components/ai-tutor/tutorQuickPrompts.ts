/**
 * 题目导师快捷追问话术（纯文本构造，不进题库、不伪造入库）。
 * “就本轮考我”：按本次讲解现场出一道单选题，对话内考。
 * “拓展追问”：按本次问答给出值得深挖的延伸问题。
 */
export function buildQuizMePrompt(skillTag?: string): string {
  const tag = skillTag ? `关于「${skillTag}」` : '';
  return `根据以上${tag}的讲解，出 1 道单选题考我：只给题干和 A-D 四个选项，先别公布答案，等我回答后再批改和讲解。`;
}

export function buildExpandAskPrompt(skillTag?: string): string {
  const tag = skillTag ? `关于「${skillTag}」` : '';
  return `基于以上${tag}的讨论，给我 3 个值得深挖的拓展问题：编号，每条一行，以问号结尾，简短，不要展开讲解。`;
}
