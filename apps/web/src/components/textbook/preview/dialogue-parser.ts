import type { StudySegment } from './study-view.js';

export type SpeakerGender = 'male' | 'female' | 'neutral';

const MALE_NAME_PATTERNS = [
  /^(ミラー|サントス|シュミット|ワット|ワン|グプタ|ジョン|マイク|トム|ボブ|ピーター|スミス|李|田中|木村|山田|森|王|佐藤健)$/i,
  /(父|お父さん|パパ|兄|弟|おじいさん|祖父|彼|男|息子|夫|主人|旦那|少年|おじさん|お兄さん|おとうと|おにいさん|君|くん)$/,
];

const FEMALE_NAME_PATTERNS = [
  /^(メアリー|アンナ|エミリー|マリア|リサ|サラ|ジェーン|花子|さくら|美咲|結衣|陽菜|愛|カリナ|テレサ|小野|佐藤)$/i,
  /(母|お母さん|ママ|姉|妹|おばあさん|祖母|彼女|女|娘|妻|家内|奥さん|少女|おばさん|お姉さん|いもうと|おねえさん|ちゃん)$/,
];

/**
 * 启发式推断说话人性别：优先人名/称谓模式，在双人对话场景下自动互斥分配以保持听感对比度。
 */
export function detectSpeakerGender(
  speaker: string,
  contextSpeakers?: readonly string[],
): SpeakerGender {
  const clean = speaker.trim();
  if (!clean) return 'neutral';

  for (const pattern of MALE_NAME_PATTERNS) {
    if (pattern.test(clean)) return 'male';
  }

  for (const pattern of FEMALE_NAME_PATTERNS) {
    if (pattern.test(clean)) return 'female';
  }

  // 双人对话互斥对比：如果另一位明确为男声/女声，本角色自动采用相反性别以区分
  if (contextSpeakers && contextSpeakers.length === 2) {
    const other = contextSpeakers.find((s) => s.trim() !== clean);
    if (other) {
      const otherClean = other.trim();
      const otherIsMale = MALE_NAME_PATTERNS.some((p) => p.test(otherClean));
      const otherIsFemale = FEMALE_NAME_PATTERNS.some((p) => p.test(otherClean));
      if (otherIsMale && !otherIsFemale) return 'female';
      if (otherIsFemale && !otherIsMale) return 'male';

      // 两位角色均为通用身份（如“管理人”与“住人”、“店員”与“客”）：首个说话人设为女声，次个设为男声
      const index = contextSpeakers.indexOf(speaker);
      return index === 0 ? 'female' : 'male';
    }
  }

  return 'neutral';
}

const DIALOGUE_LINE_REGEX = /^([^：:\n]{1,16})[：:]\s*(.+)$/;

/**
 * 解析教材文章文本。若包含连续角色对白格式（如“管理人：... \n ミラー：...”），
 * 自动将其结构化为带有 speaker 与 gender 的 StudySegment 列表；否则返回 null。
 */
export function parseArticleDialogueSegments(article: {
  text: string;
  translation?: string | undefined;
}): StudySegment[] | null {
  const rawLines = article.text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rawLines.length < 2) return null;

  const matches: Array<{ speaker: string; text: string }> = [];
  let dialogueCount = 0;

  for (const line of rawLines) {
    const match = line.match(DIALOGUE_LINE_REGEX);
    if (match) {
      dialogueCount++;
      matches.push({ speaker: match[1]!.trim(), text: match[2]!.trim() });
    } else if (matches.length > 0) {
      // 允许多行折行台词接续在上一句
      matches[matches.length - 1]!.text += `\n${line}`;
    }
  }

  // 至少有 2 句以上匹配且大部分为对白，才认定为会话
  if (dialogueCount < 2 || dialogueCount / rawLines.length < 0.5) {
    return null;
  }

  const uniqueSpeakers = [...new Set(matches.map((m) => m.speaker))];

  // 尝试解析中文译文对应的对白
  const transLines = article.translation
    ? article.translation.split('\n').map((l) => l.trim()).filter(Boolean)
    : [];

  const transMap = new Map<number, string>();
  for (let i = 0; i < transLines.length; i++) {
    const tLine = transLines[i]!;
    const tMatch = tLine.match(DIALOGUE_LINE_REGEX);
    if (tMatch) {
      transMap.set(i, tMatch[2]!.trim());
    } else {
      transMap.set(i, tLine);
    }
  }

  return matches.map((m, index) => {
    const gender = detectSpeakerGender(m.speaker, uniqueSpeakers);
    const translation = transMap.get(index);
    return {
      speaker: m.speaker,
      text: m.text,
      gender,
      ...(translation ? { translation } : {}),
    };
  });
}
