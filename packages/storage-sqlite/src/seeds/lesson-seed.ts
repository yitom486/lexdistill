/**
 * 语法讲义种子（先讲后测 · 第一批：覆盖题库真实存在考点的 N5 点 + N4 たら）。
 * 项目自撰中文讲解与例句译文；例句均为基础句型，不复制任何教材原文。
 * id 即技能 id（= quiz testedSkillId）：有讲义且未学完的技能，系统代选时不出题。
 */
import type { LearnerLevel } from '@study-studio/protocol';

export interface LessonExampleSeed {
  ja: string;
  reading: string;
  zh: string;
}

export interface LessonSectionSeed {
  heading: string;
  body: string[];
}

export interface LessonSeed {
  skillId: string;
  language: 'ja' | 'en' | 'ko';
  minLevel: LearnerLevel;
  title: string;
  summary: string;
  sections: LessonSectionSeed[];
  examples: LessonExampleSeed[];
  pitfall: string;
  sortOrder: number;
}

export const LESSON_SEEDS: LessonSeed[] = [
  {
    skillId: 'jp.particle.ni_vs_de',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '场所助词「で」与「に」',
    summary: '动作发生的场所用で，静态存在的地方用に。一句话分清。',
    sections: [
      {
        heading: '一句话规则',
        body: [
          '「で」标动作发生的场所：读书、吃饭、开会这些“动起来”的事，地点用で。',
          '「に」标存在的地方：人或东西“在”哪里，存在句（います/あります）的地方用に。',
        ],
      },
      {
        heading: '判断口诀',
        body: [
          '先看句尾动词：是“做事”（読む、食べる、勉強する）→ で；',
          '是“存在”（いる、ある、住む）→ に。',
        ],
      },
    ],
    examples: [
      { ja: 'カフェで本を読みました。', reading: 'かふぇで ほんを よみました。', zh: '在咖啡馆读了书。（读书是动作→で）' },
      { ja: '机の上に教科書があります。', reading: 'つくえの うえに きょうかしょが あります。', zh: '桌子上有教科书。（存在→に）' },
      { ja: '図書館で勉強します。', reading: 'としょかんで べんきょうします。', zh: '在图书馆学习。（学习是动作→で）' },
    ],
    pitfall: '「に」还有表目的地（東京に行く）和时间的用法，别和存在に混了；本课只管“存在的地方”。',
    sortOrder: 10,
  },
  {
    skillId: 'jp.particle.destination_ni',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '移动目的地「に」',
    summary: '去哪里、到哪里：移动动词的目的地用に（へ也可，口语多用に）。',
    sections: [
      {
        heading: '一句话规则',
        body: [
          '行く、来る、帰る这类移动动词，后面跟“去的地方”，用に。',
          'へ也可以，意思一样；考试和口语里に更常见。',
        ],
      },
      {
        heading: '和存在に的区别',
        body: [
          '存在に + いる/ある（静态）；目的地に + 行く/来る/帰る（移动）。',
          '看动词就知道是哪个に。',
        ],
      },
    ],
    examples: [
      { ja: '明日、図書館に行きます。', reading: 'あした、としょかんに いきます。', zh: '明天去图书馆。（移动→に）' },
      { ja: '友達が家に来ました。', reading: 'ともだちが いえに きました。', zh: '朋友来我家了。（移动→に）' },
      { ja: '毎日8時に学校に行きます。', reading: 'まいにち 8じに がっこうに いきます。', zh: '每天8点去学校。' },
    ],
    pitfall: '交通工具（电车、公交）用で（電車で学校に行く），别把“坐什么去”和“去哪里”弄混。',
    sortOrder: 20,
  },
  {
    skillId: 'jp.particle.ka',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '疑问助词「か」',
    summary: '句尾加か，普通句子变疑问句；か还可以表示“不确定”。',
    sections: [
      {
        heading: '一句话规则',
        body: [
          '陈述句尾 + か = 疑问句，语调上扬。回答用 はい/いいえ。',
          'か + 也不知道的内容 = “……吧/呢”（表不确定），如「どこか」某个地方。',
        ],
      },
    ],
    examples: [
      { ja: 'これは本ですか。', reading: 'これは ほんですか。', zh: '这是书吗？' },
      { ja: '明日、雨が降りますか。', reading: 'あした、あめが ふりますか。', zh: '明天下雨吗？' },
      { ja: '誰か来ましたか。', reading: 'だれか きましたか。', zh: '有人来了吗？（誰か=某人）' },
    ],
    pitfall: '口语里か常省略（本？行く？），升调即疑问；但考试写句必须加か。',
    sortOrder: 30,
  },
  {
    skillId: 'jp.particle.no',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '领格助词「の」',
    summary: 'AのB：A 说明 B 是什么/是谁的。名词连名词的万能胶水。',
    sections: [
      {
        heading: '一句话规则',
        body: [
          'AのB = “A 的 B / 属于 A 的 B”：私の本（我的书）、日本の映画（日本的电影）。',
          'の还可以把句子名词化（読むのが好き），那是 N4 用法，本课只管“名词+の+名词”。',
        ],
      },
    ],
    examples: [
      { ja: '私の先生は田中さんです。', reading: 'わたしの せんせいは たなかさんです。', zh: '我的老师是田中先生。' },
      { ja: 'これは友達の傘です。', reading: 'これは ともだちの かさです。', zh: '这是朋友的伞。' },
      { ja: '駅の前で会いましょう。', reading: 'えきの まえで あいましょう。', zh: '在车站前面见面吧。' },
    ],
    pitfall: '中文“我朋友”日语必须私の友達，の不能省；但 family 称谓+さん（田中さん）是礼貌，别说成田中のさん。',
    sortOrder: 40,
  },
  {
    skillId: 'jp.grammar.reason_kara',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '原因「から」',
    summary: 'AからB：因为 A，所以 B。接续全是普通形+から。',
    sections: [
      {
        heading: '一句话规则',
        body: [
          '原因句 + から + 结果句。原因部分用普通形：雨が降るから、安いから、学生だから。',
          'な形容词/名词 + から时要加だ：静かだから、雨だから。',
        ],
      },
    ],
    examples: [
      { ja: '雨が降るから、行きません。', reading: 'あめが ふるから、いきません。', zh: '因为下雨，所以不去了。' },
      { ja: '安いから、これを買います。', reading: 'やすいから、これを かいます。', zh: '因为便宜，所以买这个。' },
      { ja: '明日は休みだから、遊びに行きます。', reading: 'あしたは やすみだから、あそびに いきます。', zh: '因为明天休息，所以出去玩。' },
    ],
    pitfall: 'ので也表原因（更委婉），N5 先只用から；から前面不能直接加です/ます（×降りますから→○降るから）。',
    sortOrder: 50,
  },
  {
    skillId: 'jp.keigo.self_introduction',
    language: 'ja',
    minLevel: 'NOVICE',
    title: '自我介绍三句',
    summary: '初めまして・〜と申します・よろしくお願いします。第一天就能用的日语。',
    sections: [
      {
        heading: '固定三句',
        body: [
          'はじめまして。（初次见面。）',
          'わたしは〜と申します。（我叫……。“申します”是“言います”的自谦语，比です更礼貌。）',
          'よろしくおねがいします。（请多关照。）',
        ],
      },
    ],
    examples: [
      { ja: 'はじめまして。', reading: 'はじめまして。', zh: '初次见面。' },
      { ja: '私は田中と申します。', reading: 'わたしは たなかと もうします。', zh: '我叫田中。' },
      { ja: 'よろしくお願いします。', reading: 'よろしく おねがいします。', zh: '请多关照。' },
    ],
    pitfall: '自分の名前 + さん是错的（×田中さんです自称时）；对自己用と申します，对别人用さん。',
    sortOrder: 60,
  },
  {
    skillId: 'jp.grammar.conditional_tara',
    language: 'ja',
    minLevel: 'BEGINNER',
    title: '假定条件「～たら」',
    summary: '“如果……就……”：动词/形容词变过去式+ら。N4 第一个条件形。',
    sections: [
      {
        heading: '变法（三步）',
        body: [
          '动词：先变た形，再加ら。降る→降った→降ったら；食べる→食べた→食べたら；来る→来た→来たら。',
          '一类形容词：い→かったら。高い→高かったら。',
          '二类形容词/名词：+ だったら。静か→静かだったら；雨→雨だったら。',
        ],
      },
      {
        heading: '两种意思',
        body: [
          '① 如果（假设）：雨が降ったら、行きません。（如果下雨就不去。）',
          '② 一……就（既定）：家に帰ったら、電話します。（一到家就打电话。）',
        ],
      },
    ],
    examples: [
      { ja: '雨が降ったら、試合は中止です。', reading: 'あめが ふったら、しあいは ちゅうしです。', zh: '如果下雨，比赛就中止。' },
      { ja: '安かったら、買います。', reading: 'やすかったら、かいます。', zh: '如果便宜就买。' },
      { ja: '暇だったら、映画を見ます。', reading: 'ひまだったら、えいがを みます。', zh: '如果有空就看电影。' },
    ],
    pitfall: '五段动词先想た形（行く→行った→行ったら，く变 いった 别写成 くった）；たら后不能接命令请求以外的意志句是 N3 考点，N4 先不管。',
    sortOrder: 70,
  },
];
