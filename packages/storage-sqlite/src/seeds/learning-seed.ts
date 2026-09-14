/**
 * 学习域权威初始冷启动种子数据 (Restrained Cold-start Seeds)
 * 仅用于 SQLite 初次建库/安装时的极简入门示例（克制、高质感）
 * 一旦数据库存在数据，系统 100% 严格使用数据库中的最新真实资产 (SSOT)
 */

export interface CardSeed {
  id: string;
  type: string;
  front: string;
  back: string;
  phonetic?: string | null;
  audioUrl?: string | null;
  tags: string[];
  exampleJp?: string;
  exampleHighlight?: string;
  exampleZh?: string;
  stability: number;
  reps: number;
}

export interface QuestionSeed {
  id: string;
  type: 'CHOICE' | 'FILL_BLANK' | 'REORDER';
  category: string;
  prompt: string;
  content: string;
  options?: { key: string; text: string; note?: string }[];
  chunks?: string[];
  correctAnswer: string;
  explanation: string;
  testedSkillId: string;
  difficulty: number;
}

export interface MistakeSeed {
  id: string;
  questionId: string;
  categoryTag: string;
  prompt: string;
  sentence: string;
  userWrongAnswer: string;
  correctAnswer: string;
  testedSkillId: string;
  reviewNote: string;
  consecutiveCorrect: number;
  isResolved: boolean;
}

export interface SkillMetricSeed {
  skillId: string;
  dimension: string;
  name: string;
  proficiency: number;
  totalAttempts: number;
  correctAttempts: number;
  consecutiveErrors: number;
  status: 'STRENGTH' | 'WEAKNESS' | 'NORMAL';
}

/**
 * 官方精选出厂 FSRS 示范卡片（克制保留 2 张初始待学范例，初始复习次数为 0）。
 * 零基础第一印象：必须 N5 起步（此前 約束/おかげで 为 N3，新人 Day-1 见到即劝退）。
 * id 保持稳定（card_01/card_02），老用户存量卡不受影响。
 */
export const INITIAL_CARD_SEEDS: CardSeed[] = [
  {
    id: 'card_01',
    type: 'VOCAB',
    front: '食べる',
    phonetic: 'たべる',
    back: '吃',
    tags: ['N5', '核心词汇'],
    exampleJp: 'ごはんを食べます。',
    exampleHighlight: '食べます',
    exampleZh: '我吃饭。',
    stability: 1.0,
    reps: 0,
  },
  {
    id: 'card_02',
    type: 'GRAMMAR',
    front: '～は～です',
    phonetic: '',
    back: '判断句：A 是 B',
    tags: ['N5', '基本句型'],
    exampleJp: '私は学生です。',
    exampleHighlight: 'は',
    exampleZh: '我是学生。',
    stability: 1.0,
    reps: 0,
  },
];

/**
 * 官方精选出厂英语 FSRS 示范卡片（入门可感范例；此前 ambiguity/subtle 为六级/考研词）。
 * id 保持稳定（card_en_01/card_en_02），老用户存量卡不受影响。
 */
export const INITIAL_EN_CARD_SEEDS: CardSeed[] = [
  {
    id: 'card_en_01',
    type: 'VOCAB',
    front: 'water',
    phonetic: '/ˈwɔːtər/',
    back: 'n. 水',
    tags: ['入门', '核心词汇'],
    exampleJp: 'I drink water every day.',
    exampleHighlight: 'water',
    exampleZh: '我每天喝水。',
    stability: 1.0,
    reps: 0,
  },
  {
    id: 'card_en_02',
    type: 'VOCAB',
    front: 'happy',
    phonetic: '/ˈhæpi/',
    back: 'adj. 高兴的',
    tags: ['入门', '核心形容词'],
    exampleJp: 'The children are happy today.',
    exampleHighlight: 'happy',
    exampleZh: '孩子们今天很高兴。',
    stability: 1.0,
    reps: 0,
  },
];

/**
 * 官方精选自适应题库示范题（克制保留 2 道标准示范题供学员开启练习）
 */
export const INITIAL_QUESTION_SEEDS: QuestionSeed[] = [
  {
    id: 'q_01',
    type: 'CHOICE',
    category: '助词辨析',
    prompt: '选择最恰当的助词填入括号：',
    content: '夏休みに、友だちと京都（　）行きました。',
    options: [
      { key: 'A', text: 'で', note: '表示动作场所或工具手段' },
      { key: 'B', text: 'に', note: '表示移动的目的地、到达点' },
      { key: 'C', text: 'を', note: '表示动作对象或离开场所' },
      { key: 'D', text: 'から', note: '表示起点或出处' },
    ],
    correctAnswer: 'B',
    explanation:
      '动词「行きました」为移动动词，表示移动目的地、到达点时必须使用格助词「に」或方向助词「へ」；「で」则用于动作发生的场所。',
    testedSkillId: 'jp.particle.destination_ni',
    difficulty: 2,
  },
  {
    id: 'q_02',
    type: 'FILL_BLANK',
    category: '动词假定形',
    prompt: '将括号中的动词变形为正确的假定形（～たら）：',
    content: '明日、雨が（降る ──►　　　　）、試合は中止です。',
    correctAnswer: '降ったら',
    explanation:
      '动词「降る」（五段动词）的过去式为「降った」，后接「ら」构成假定条件「降ったら」，表示“如果下雨的话”。',
    testedSkillId: 'jp.grammar.conditional_tara',
    difficulty: 3,
  },
];

/**
 * 官方精选英语自适应题库示范题（考研/六级核心语法）
 */
export const INITIAL_EN_QUESTION_SEEDS: QuestionSeed[] = [
  {
    id: 'q_en_01',
    type: 'CHOICE',
    category: '虚拟语气',
    prompt: '选择最恰当的动词形式填入括号（虚拟语气）：',
    content: 'The committee insisted that the new safety regulations ( ) into effect immediately.',
    options: [
      { key: 'A', text: 'be put', note: '虚拟语气 (should) + 动词原形' },
      { key: 'B', text: 'were put', note: '一般过去时' },
      { key: 'C', text: 'are put', note: '一般现在时' },
      { key: 'D', text: 'have been put', note: '现在完成时' },
    ],
    correctAnswer: 'A',
    explanation:
      '动词 insist 表示“坚决主张/要求”时，其后宾语从句必须使用虚拟语气结构 (should) + 动词原形，此处为被动语态，故用 (should) be put。',
    testedSkillId: 'en.grammar.subjunctive',
    difficulty: 3,
  },
  {
    id: 'q_en_02',
    type: 'FILL_BLANK',
    category: '部分倒装',
    prompt: '将否定副词 Not only 置于句首，填入助动词与主语构成倒装：',
    content: 'Not only ( ) pass the challenging exam, but he also achieved the highest score in the province.',
    correctAnswer: 'did he',
    explanation:
      'Not only ... but also ... 结构中，Not only 置于句首时前句必须使用部分倒装；由后半句 achieved 可知时态为一般过去时，助动词用 did，故为 did he。',
    testedSkillId: 'en.grammar.inversion',
    difficulty: 3,
  },
];

/**
 * 错题记录：新用户出厂默认零错题，待学员真实作答触发记录
 */

/**
 * 官方精选韩语自适应题库示范题（TOPIK 场所助词骨架）
 */
export const INITIAL_KO_QUESTION_SEEDS: QuestionSeed[] = [
  {
    id: 'q_ko_01',
    type: 'CHOICE',
    category: '조사 에/에서',
    prompt: '빈칸에 알맞은 조사를 고르세요:',
    content: '친구와 카페( ) 한국어를 공부합니다.',
    options: [
      { key: 'A', text: '에서', note: '동작이 일어나는 장소' },
      { key: 'B', text: '에', note: '존재·도착 장소' },
      { key: 'C', text: '을', note: '목적어' },
      { key: 'D', text: '와', note: '동반' },
    ],
    correctAnswer: 'A',
    explanation:
      '「공부하다」는 동작 동사이므로 장소에는 조사 「에서」를 씁니다. 「에」는 존재(있다/없다)나 도착점에 주로 사용합니다.',
    testedSkillId: 'ko.grammar.particle_eseo',
    difficulty: 2,
  },
  {
    id: 'q_ko_02',
    type: 'CHOICE',
    category: '조사 에/에서',
    prompt: '빈칸에 알맞은 조사를 고르세요:',
    content: '책상 위( ) 사전이 있습니다.',
    options: [
      { key: 'A', text: '에', note: '존재 위치' },
      { key: 'B', text: '에서', note: '동작 장소' },
      { key: 'C', text: '을', note: '목적어' },
      { key: 'D', text: '로', note: '방향·수단' },
    ],
    correctAnswer: 'A',
    explanation:
      '「있다」는 존재를 나타내므로 장소 조사는 「에」입니다. 동작이 일어나는 장소에는 「에서」를 씁니다.',
    testedSkillId: 'ko.grammar.particle_eseo',
    difficulty: 2,
  },
];

export const INITIAL_MISTAKE_SEEDS: MistakeSeed[] = [];

/**
 * 技能画像指标：新用户出厂初始为空，完成自适应做题后动态生成专属真实评测
 */
export const INITIAL_SKILL_METRIC_SEEDS: SkillMetricSeed[] = [];

