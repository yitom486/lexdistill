/**
 * 假名 AI 导师上下文构造器（纯函数，不绑定任何 UI）。
 * 任何页面（矩阵详情卡、自测反馈、错题回炉…）只需传入假名与题池，
 * 即可拿到可直接灌入导师抽屉的 AiTutorContext；基础记忆引导语来自可审校的课程讲义资产，
 * 讲义有明确对照时使用课程内容，旧数据才从题池补充；个性化追问交给 AI。
 */
import type { KanaItem } from '@lexdistill/protocol';
import type { AiTutorContext } from '../stores/tutor-context.js';
import { confusionDistractors, type KanaScript } from './kana-confusion.js';

export interface KanaTutorInput {
  kana: KanaItem;
  /** 题池（用于推导形近字；为空时只讲本字，不阻断）。 */
  pool?: KanaItem[] | undefined;
  script?: KanaScript | undefined;
  /** 自测刚答错时传入，导师着重讲清错因。 */
  wasWrong?: boolean | undefined;
  /** 答错时用户选的选项字面。 */
  userPick?: string | null | undefined;
}

function faceOf(kana: KanaItem, script: KanaScript): string {
  return script === 'KATAKANA' ? kana.katakana : kana.hiragana;
}

/**
 * 为单个假名构造“帮我记住它”的导师上下文：
 * 中文联想口诀 + 形近字一眼区分法 + 跟读嘴形要点；
 * 答错时追加错因追问。返回体与既有抽屉契约一致。
 */
export function buildKanaTutorContext(input: KanaTutorInput): AiTutorContext {
  const { kana, pool = [], script = 'HIRAGANA', wasWrong = false, userPick = null } = input;
  const face = faceOf(kana, script);
  const guide = kana.learningGuide;
  const scriptGuide = guide?.scripts?.[script === 'KATAKANA' ? 'katakana' : 'hiragana'];
  const neighbors = scriptGuide
    ? scriptGuide.contrasts.map((item) => item.kana)
    : confusionDistractors(kana, pool, script, 3);
  const contrast = neighbors.length > 0 ? `它和「${neighbors.join('」「')}」` : '它';
  const skillTag = script === 'KATAKANA' ? 'jp.kana.katakana' : 'jp.kana.hiragana';
  const guideFacts = guide
    ? [
        `课程事实：${guide.soundDescription}`,
        `内置联想（不是字源）：${scriptGuide?.memoryTip ?? (script === 'HIRAGANA' ? guide.memoryTip : '使用当前片假名的实际形状，不套用平假名字形联想。')}`,
        `发音提示：${guide.pronunciationTip}`,
        ...(scriptGuide ? [
          `字形观察：${scriptGuide.shapeFeatures.join(' ')}`,
          `辨认口令：${scriptGuide.recognitionCue}`,
          `具体对照：${scriptGuide.contrasts.map((item) => `${item.kana}：${item.difference}`).join(' ')}`,
        ] : script === 'HIRAGANA' && guide.confusionNotes ? [`易混提醒：${guide.confusionNotes}`] : []),
      ].join(' ')
    : `课程事实：它表示 ${kana.romaji} 这一拍；假名本身通常没有独立中文词义。`;
  const examples = scriptGuide?.exampleWords ?? guide?.exampleWords;
  const exampleHint = examples?.length
    ? `可参考例词：${examples
        .map((item) => `${item.word}（${item.reading}，${item.meaning}）`)
        .join('、')}。`
    : '';

  const questionText =
    `请帮我记住日语假名「${face}」（${kana.romaji}）。` +
    `先尊重下面的课程事实，不要把假名编造成一个有独立中文词义的汉字：${guideFacts} ${exampleHint}` +
    `请给三样东西：1) 一句适合初学者的中文联想口诀（越形象越好）；` +
    `2) ${contrast}放在一起时的一眼区分法；` +
    `3) 跟读时的嘴形与易错点。` +
    (wasWrong
      ? `我刚才把它认成了「${userPick ?? '?'}」，请重点讲清为什么错、下次怎么一眼看对。`
      : `只讲记忆法，不要展开超纲语法。`);

  const explanationParts = [
    `假名【${face}】(${kana.romaji})，${script === 'HIRAGANA' && !scriptGuide ? kana.mnemonic || '标准发音单元' : '标准发音单元'}。`,
    guide?.soundDescription,
    scriptGuide?.memoryTip ?? (script === 'HIRAGANA' ? guide?.memoryTip : undefined),
    guide?.pronunciationTip,
    ...(neighbors.length > 0 ? [`易混对照：${neighbors.join('、')}。`] : []),
  ].filter((part): part is string => Boolean(part));
  const explanation = `${explanationParts.join(' ')} 注意发音嘴形与送气控制。`;

  return {
    questionText,
    ...(wasWrong && userPick ? { userAnswer: userPick } : {}),
    correctAnswer: `${kana.hiragana} / ${kana.katakana} (${kana.romaji})`,
    skillTag,
    explanation,
  };
}
