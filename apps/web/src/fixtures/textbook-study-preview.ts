import type { ChapterStudy, StudySegment } from '../components/textbook/preview/study-view.js';

const objects: StudySegment[] = [
  { speaker: '田中', text: 'これは何ですか。', translation: '这是什么？', note: '「何」在这里读作「なん」。用「ですか」礼貌地提问。', knowledgeTitles: ['これ・それ・あれ：指认物品'] },
  { speaker: '李', text: 'それは日本語の本です。', translation: '那是一本日语书。', note: '书在田中手中，李用「それ」指靠近对方的东西。「日本語の本」说明书的类别。', knowledgeTitles: ['これ・それ・あれ：指认物品'] },
  { speaker: '田中', text: 'そうですか。これはだれの本ですか。', translation: '这样啊。这是谁的书？', note: '先回应，再用「だれの」问归属。', knowledgeTitles: ['「の」：表达物品的归属'] },
  { speaker: '李', text: 'わたしのです。', translation: '是我的。', note: '双方已经知道在说书，因此可以省略「本」。', knowledgeTitles: ['「の」：表达物品的归属'] },
  { speaker: '田中', text: 'あれも李さんのですか。', translation: '那个也是李的东西吗？', note: '「あれ」指远离双方的物品，「も」表示“也”。', knowledgeTitles: ['これ・それ・あれ：指认物品'] },
  { speaker: '李', text: 'いいえ、違います。あれは先生の辞書です。', translation: '不，不是。那个是老师的词典。', note: '否认后补充正确的信息，比只回答“不”更清楚。', knowledgeTitles: ['そうです／違います：确认与否认', '「の」：表达物品的归属'] },
];
const greetings: StudySegment[] = [
  { speaker: '李', text: 'はじめまして。李です。', translation: '初次见面，我姓李。', note: '「はじめまして」用于第一次见面；介绍自己时可省略「わたしは」。', knowledgeTitles: ['名词 ＋ は ＋ 名词 ＋ です'] },
  { speaker: '田中', text: '田中です。よろしくお願いします。', translation: '我姓田中。请多关照。', note: '介绍姓名后，用「よろしくお願いします」建立礼貌的交往。' },
  { speaker: '李', text: 'こちらこそ、よろしくお願いします。', translation: '也请您多关照。', note: '「こちらこそ」用于回应对方的客气话，相当于“我才要请您……”。' },
];
const directions: StudySegment[] = [
  { speaker: '旅行者', text: 'すみません。駅はどこですか。', translation: '打扰一下，车站在哪里？', note: '先礼貌地引起注意，再问位置。', knowledgeTitles: ['すみません：礼貌地引起注意'] },
  { speaker: '通行人', text: 'まっすぐ行って、右に曲がってください。', translation: '请直走，然后向右转。', note: '注意两个动作的顺序：先直走，再右转。「ください」用于礼貌地给出指引。' },
  { speaker: '旅行者', text: 'ありがとうございます。', translation: '谢谢。', note: '得到帮助后，用完整的礼貌表达感谢对方。' },
];
/** One source for the complete text and the interactive, aligned turns. No line-index guessing. */
export function segmentText(segments: StudySegment[], translated = false): string {
  return segments.map(segment => `${segment.speaker ? `${segment.speaker}：` : ''}${translated ? segment.translation ?? '' : segment.text}`).join('\n');
}
export const previewStudy: Record<string, ChapterStudy> = {
  'preview-objects': {
    introduction: '本课围绕**教室里的物品**：先听两人的对话，再练习指认、询问名称和表达归属。重点是选对指示词，并把「の」放在正确的位置。',
    goals: ['根据物品的位置选择これ／それ／あれ。', '用「これは何ですか」询问物品名称。', '用「だれの」询问归属，并作简短回答。', '能确认或否认对方的判断，并补充正确的信息。'],
    steps: [ { title: '听懂对话', description: '先听一遍；再逐句展开译文和注意点。', section: 'articles' }, { title: '认识物品词', description: '听读词汇，用例句确认词义。', section: 'vocabulary' }, { title: '说清三个表达', description: '理解指示词、归属和确认/否认。', section: 'grammar' }, { title: '独立说一句', description: '遮住译文，尝试自己表达。', section: 'sentences' }, { title: '练习与复盘', description: '试答后对照解析，再核对本课目标。', section: 'exercises' } ],
    summary: '**指认**：これ靠近自己，それ靠近对方，あれ远离双方。\n\n**归属**：人＋の＋物品；物品明确时可以说「わたしのです」。\n\n**回应**：确认用「はい、そうです」，否认后可补充实际名称。\n\n注意：「これ」可以独立使用，「この」后面必须接名词。',
    selfCheck: [{ question: '我拿着书，应该用これ还是それ？', answer: '用これ，因为书靠近说话人。' }, { question: '如何问“这是谁的包”？', answer: 'これはだれのかばんですか。' }, { question: '为什么「わたしのです」可以省略物品名称？', answer: '语境中物品已经明确，「の」可以代替已知物品。' }], articles: { 'preview-a1': objects },
  },
  'preview-greetings': {
    introduction: '学习**初次见面的交流顺序**：打招呼 → 介绍自己 → 表达礼貌 → 回应对方。读完后，尝试换成自己的名字。',
    goals: ['能用「名前＋です」介绍自己。', '理解「は」在话题中的用法和读音。', '能用「よろしくお願いします」及「こちらこそ」回应对方。'],
    steps: [{ title: '听初次见面', description: '听懂两位角色的交流顺序。', section: 'articles' }, { title: '学身份与表达', description: '认识学生，理解「名词＋です」。', section: 'grammar' }, { title: '换成自己的名字', description: '听读礼貌句，再完成练习。', section: 'sentences' }, { title: '检查表达', description: '核对自我介绍的用法。', section: 'exercises' }],
    summary: '自我介绍用**名字＋です**。\n\n「はじめまして」用于第一次见面。对方说「よろしくお願いします」时，可以用「こちらこそ」回应。\n\n话题助词「は」写作は，读作wa。',
    selfCheck: [{ question: '请用自己的名字说一句自我介绍。', answer: '例如「わたしは李です」。也可以省略わたしは，说「李です」。' }, { question: '如何回应“请多关照”？', answer: 'こちらこそ、よろしくお願いします。' }], articles: { 'preview-greeting-a1': greetings },
  },
  'preview-directions': {
    introduction: '围绕**问路**，听懂“打扰一下”“在哪里”和按顺序给出的方向。重点是先辨认目的地，再理解行动顺序。',
    goals: ['能礼貌地询问车站的位置。', '听懂直走和右转的指引。', '得到帮助后表达感谢。'],
    steps: [{ title: '听问路对话', description: '先听再看译文，注意动作顺序。', section: 'articles' }, { title: '记住目的地与方向', description: '听读駅和右。', section: 'vocabulary' }, { title: '理解礼貌表达', description: '查看すみません的用法。', section: 'grammar' }, { title: '检验方向词', description: '完成配对并核对。', section: 'exercises' }],
    summary: '问路前说**すみません**，询问位置用「どこですか」。\n\n「まっすぐ行って、右に曲がってください」是先直走，再右转。\n\n得到帮助后说「ありがとうございます」。',
    selfCheck: [{ question: '听到“まっすぐ行って、右に曲がって”，先做什么？', answer: '先直走，再向右转。' }], articles: { 'preview-travel-a1': directions },
  },
};
