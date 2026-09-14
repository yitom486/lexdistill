/**
 * 日语 N5 核心 100 词（开箱即用，零配置可查可收）。
 * 项目自撰中文释义，不复制 JMdict/任何教材条目；与 starter 包（纯假名 24 词）互补：
 * 本表正在学汉字表记（含标准读音），是假名阶段之后的第一批“能读会认”的词。
 * 用户后装 JMdict 与之并存（不同 source_id，可开关）。
 */
import type { StarterWordSeed } from './starter-words-seed.js';

export const N5_SOURCE_ID = 'study-studio-n5-ja-v1';
export const N5_SOURCE_LABEL = 'N5 核心词';
export const N5_LICENSE = 'Project-authored N5 core vocabulary';

export const N5_WORD_SEEDS: StarterWordSeed[] = [
  // ================= 人/代词（10） =================
  { id: 'n5_ja_watashi', language: 'ja', headword: '私', reading: 'わたし', meanings: ['我'], partOfSpeech: '代词' },
  { id: 'n5_ja_anata', language: 'ja', headword: 'あなた', reading: 'あなた', meanings: ['你'], partOfSpeech: '代词' },
  { id: 'n5_ja_kare', language: 'ja', headword: '彼', reading: 'かれ', meanings: ['他'], partOfSpeech: '代词' },
  { id: 'n5_ja_kanojo', language: 'ja', headword: '彼女', reading: 'かのじょ', meanings: ['她'], partOfSpeech: '代词' },
  { id: 'n5_ja_hito', language: 'ja', headword: '人', reading: 'ひと', meanings: ['人'], partOfSpeech: '名词' },
  { id: 'n5_ja_otoko', language: 'ja', headword: '男', reading: 'おとこ', meanings: ['男人'], partOfSpeech: '名词' },
  { id: 'n5_ja_onna', language: 'ja', headword: '女', reading: 'おんな', meanings: ['女人'], partOfSpeech: '名词' },
  { id: 'n5_ja_kodomo', language: 'ja', headword: '子供', reading: 'こども', meanings: ['孩子'], partOfSpeech: '名词' },
  { id: 'n5_ja_kazoku', language: 'ja', headword: '家族', reading: 'かぞく', meanings: ['家人'], partOfSpeech: '名词' },
  { id: 'n5_ja_tomodachi', language: 'ja', headword: '友達', reading: 'ともだち', meanings: ['朋友'], partOfSpeech: '名词' },
  // ================= 身份（5） =================
  { id: 'n5_ja_sensei', language: 'ja', headword: '先生', reading: 'せんせい', meanings: ['老师'], partOfSpeech: '名词' },
  { id: 'n5_ja_gakusei', language: 'ja', headword: '学生', reading: 'がくせい', meanings: ['学生'], partOfSpeech: '名词' },
  { id: 'n5_ja_shain', language: 'ja', headword: '社員', reading: 'しゃいん', meanings: ['公司职员'], partOfSpeech: '名词' },
  { id: 'n5_ja_isha', language: 'ja', headword: '医者', reading: 'いしゃ', meanings: ['医生'], partOfSpeech: '名词' },
  { id: 'n5_ja_tenin', language: 'ja', headword: '店員', reading: 'てんいん', meanings: ['店员'], partOfSpeech: '名词' },
  // ================= 学校（7） =================
  { id: 'n5_ja_gakkou', language: 'ja', headword: '学校', reading: 'がっこう', meanings: ['学校'], partOfSpeech: '名词' },
  { id: 'n5_ja_kyoushitsu', language: 'ja', headword: '教室', reading: 'きょうしつ', meanings: ['教室'], partOfSpeech: '名词' },
  { id: 'n5_ja_jisho', language: 'ja', headword: '辞書', reading: 'じしょ', meanings: ['词典'], partOfSpeech: '名词' },
  { id: 'n5_ja_shukudai', language: 'ja', headword: '宿題', reading: 'しゅくだい', meanings: ['作业'], partOfSpeech: '名词' },
  { id: 'n5_ja_shiken', language: 'ja', headword: '試験', reading: 'しけん', meanings: ['考试'], partOfSpeech: '名词' },
  { id: 'n5_ja_enpitsu', language: 'ja', headword: '鉛筆', reading: 'えんぴつ', meanings: ['铅笔'], partOfSpeech: '名词' },
  { id: 'n5_ja_kaban', language: 'ja', headword: '鞄', reading: 'かばん', meanings: ['书包'], partOfSpeech: '名词' },
  // ================= 家/生活（8） =================
  { id: 'n5_ja_ie', language: 'ja', headword: '家', reading: 'いえ', meanings: ['家'], partOfSpeech: '名词' },
  { id: 'n5_ja_heya', language: 'ja', headword: '部屋', reading: 'へや', meanings: ['房间'], partOfSpeech: '名词' },
  { id: 'n5_ja_denwa', language: 'ja', headword: '電話', reading: 'でんわ', meanings: ['电话'], partOfSpeech: '名词' },
  { id: 'n5_ja_terebi', language: 'ja', headword: 'テレビ', reading: 'テレビ', meanings: ['电视'], partOfSpeech: '名词' },
  { id: 'n5_ja_kuruma', language: 'ja', headword: '車', reading: 'くるま', meanings: ['汽车'], partOfSpeech: '名词' },
  { id: 'n5_ja_tsukue', language: 'ja', headword: '机', reading: 'つくえ', meanings: ['桌子'], partOfSpeech: '名词' },
  { id: 'n5_ja_isu', language: 'ja', headword: '椅子', reading: 'いす', meanings: ['椅子'], partOfSpeech: '名词' },
  { id: 'n5_ja_okane', language: 'ja', headword: 'お金', reading: 'おかね', meanings: ['钱'], partOfSpeech: '名词' },
  // ================= 外出/社会（8） =================
  { id: 'n5_ja_densha', language: 'ja', headword: '電車', reading: 'でんしゃ', meanings: ['电车'], partOfSpeech: '名词' },
  { id: 'n5_ja_hikouki', language: 'ja', headword: '飛行機', reading: 'ひこうき', meanings: ['飞机'], partOfSpeech: '名词' },
  { id: 'n5_ja_byouin', language: 'ja', headword: '病院', reading: 'びょういん', meanings: ['医院'], partOfSpeech: '名词' },
  { id: 'n5_ja_ginkou', language: 'ja', headword: '銀行', reading: 'ぎんこう', meanings: ['银行'], partOfSpeech: '名词' },
  { id: 'n5_ja_eki', language: 'ja', headword: '駅', reading: 'えき', meanings: ['车站'], partOfSpeech: '名词' },
  { id: 'n5_ja_michi', language: 'ja', headword: '道', reading: 'みち', meanings: ['路'], partOfSpeech: '名词' },
  { id: 'n5_ja_shigoto', language: 'ja', headword: '仕事', reading: 'しごと', meanings: ['工作'], partOfSpeech: '名词' },
  { id: 'n5_ja_yasumi', language: 'ja', headword: '休み', reading: 'やすみ', meanings: ['休息', '假期'], partOfSpeech: '名词' },
  // ================= 食物（12） =================
  { id: 'n5_ja_tabemono', language: 'ja', headword: '食べ物', reading: 'たべもの', meanings: ['食物'], partOfSpeech: '名词' },
  { id: 'n5_ja_nomimono', language: 'ja', headword: '飲み物', reading: 'のみもの', meanings: ['饮料'], partOfSpeech: '名词' },
  { id: 'n5_ja_gohan', language: 'ja', headword: 'ご飯', reading: 'ごはん', meanings: ['米饭'], partOfSpeech: '名词' },
  { id: 'n5_ja_pan', language: 'ja', headword: 'パン', reading: 'パン', meanings: ['面包'], partOfSpeech: '名词' },
  { id: 'n5_ja_niku', language: 'ja', headword: '肉', reading: 'にく', meanings: ['肉'], partOfSpeech: '名词' },
  { id: 'n5_ja_sakana', language: 'ja', headword: '魚', reading: 'さかな', meanings: ['鱼'], partOfSpeech: '名词' },
  { id: 'n5_ja_yasai', language: 'ja', headword: '野菜', reading: 'やさい', meanings: ['蔬菜'], partOfSpeech: '名词' },
  { id: 'n5_ja_kudamono', language: 'ja', headword: '果物', reading: 'くだもの', meanings: ['水果'], partOfSpeech: '名词' },
  { id: 'n5_ja_mizu', language: 'ja', headword: '水', reading: 'みず', meanings: ['水'], partOfSpeech: '名词' },
  { id: 'n5_ja_ocha', language: 'ja', headword: 'お茶', reading: 'おちゃ', meanings: ['茶'], partOfSpeech: '名词' },
  { id: 'n5_ja_gyuunyuu', language: 'ja', headword: '牛乳', reading: 'ぎゅうにゅう', meanings: ['牛奶'], partOfSpeech: '名词' },
  { id: 'n5_ja_tamago', language: 'ja', headword: '卵', reading: 'たまご', meanings: ['鸡蛋'], partOfSpeech: '名词' },
  // ================= 时间（12） =================
  { id: 'n5_ja_kyou', language: 'ja', headword: '今日', reading: 'きょう', meanings: ['今天'], partOfSpeech: '名词' },
  { id: 'n5_ja_ashita', language: 'ja', headword: '明日', reading: 'あした', meanings: ['明天'], partOfSpeech: '名词' },
  { id: 'n5_ja_kinou', language: 'ja', headword: '昨日', reading: 'きのう', meanings: ['昨天'], partOfSpeech: '名词' },
  { id: 'n5_ja_asa', language: 'ja', headword: '朝', reading: 'あさ', meanings: ['早晨'], partOfSpeech: '名词' },
  { id: 'n5_ja_ban', language: 'ja', headword: '晩', reading: 'ばん', meanings: ['晚上'], partOfSpeech: '名词' },
  { id: 'n5_ja_ima', language: 'ja', headword: '今', reading: 'いま', meanings: ['现在'], partOfSpeech: '副词' },
  { id: 'n5_ja_maiasa', language: 'ja', headword: '毎朝', reading: 'まいあさ', meanings: ['每天早晨'], partOfSpeech: '名词' },
  { id: 'n5_ja_maiban', language: 'ja', headword: '毎晩', reading: 'まいばん', meanings: ['每天晚上'], partOfSpeech: '名词' },
  { id: 'n5_ja_shuumatsu', language: 'ja', headword: '週末', reading: 'しゅうまつ', meanings: ['周末'], partOfSpeech: '名词' },
  { id: 'n5_ja_getsuyoubi', language: 'ja', headword: '月曜日', reading: 'げつようび', meanings: ['星期一'], partOfSpeech: '名词' },
  { id: 'n5_ja_nichiyoubi', language: 'ja', headword: '日曜日', reading: 'にちようび', meanings: ['星期天'], partOfSpeech: '名词' },
  { id: 'n5_ja_jikan', language: 'ja', headword: '時間', reading: 'じかん', meanings: ['时间'], partOfSpeech: '名词' },
  // ================= 自然（9） =================
  { id: 'n5_ja_tenki', language: 'ja', headword: '天気', reading: 'てんき', meanings: ['天气'], partOfSpeech: '名词' },
  { id: 'n5_ja_ame', language: 'ja', headword: '雨', reading: 'あめ', meanings: ['雨'], partOfSpeech: '名词' },
  { id: 'n5_ja_yuki', language: 'ja', headword: '雪', reading: 'ゆき', meanings: ['雪'], partOfSpeech: '名词' },
  { id: 'n5_ja_kumori', language: 'ja', headword: '曇', reading: 'くもり', meanings: ['多云'], partOfSpeech: '名词' },
  { id: 'n5_ja_hare', language: 'ja', headword: '晴', reading: 'はれ', meanings: ['晴天'], partOfSpeech: '名词' },
  { id: 'n5_ja_umi', language: 'ja', headword: '海', reading: 'うみ', meanings: ['海'], partOfSpeech: '名词' },
  { id: 'n5_ja_yama', language: 'ja', headword: '山', reading: 'やま', meanings: ['山'], partOfSpeech: '名词' },
  { id: 'n5_ja_hana', language: 'ja', headword: '花', reading: 'はな', meanings: ['花'], partOfSpeech: '名词' },
  { id: 'n5_ja_ki', language: 'ja', headword: '木', reading: 'き', meanings: ['树'], partOfSpeech: '名词' },
  // ================= 身体（5） =================
  { id: 'n5_ja_karada', language: 'ja', headword: '体', reading: 'からだ', meanings: ['身体'], partOfSpeech: '名词' },
  { id: 'n5_ja_atama', language: 'ja', headword: '頭', reading: 'あたま', meanings: ['头'], partOfSpeech: '名词' },
  { id: 'n5_ja_me', language: 'ja', headword: '目', reading: 'め', meanings: ['眼睛'], partOfSpeech: '名词' },
  { id: 'n5_ja_te', language: 'ja', headword: '手', reading: 'て', meanings: ['手'], partOfSpeech: '名词' },
  { id: 'n5_ja_ashi', language: 'ja', headword: '足', reading: 'あし', meanings: ['脚'], partOfSpeech: '名词' },
  // ================= 动词（15） =================
  { id: 'n5_ja_taberu', language: 'ja', headword: '食べる', reading: 'たべる', meanings: ['吃'], partOfSpeech: '动词' },
  { id: 'n5_ja_nomu', language: 'ja', headword: '飲む', reading: 'のむ', meanings: ['喝'], partOfSpeech: '动词' },
  { id: 'n5_ja_miru', language: 'ja', headword: '見る', reading: 'みる', meanings: ['看'], partOfSpeech: '动词' },
  { id: 'n5_ja_kiku', language: 'ja', headword: '聞く', reading: 'きく', meanings: ['听'], partOfSpeech: '动词' },
  { id: 'n5_ja_yomu', language: 'ja', headword: '読む', reading: 'よむ', meanings: ['读'], partOfSpeech: '动词' },
  { id: 'n5_ja_kaku', language: 'ja', headword: '書く', reading: 'かく', meanings: ['写'], partOfSpeech: '动词' },
  { id: 'n5_ja_hanasu', language: 'ja', headword: '話す', reading: 'はなす', meanings: ['说'], partOfSpeech: '动词' },
  { id: 'n5_ja_kau', language: 'ja', headword: '買う', reading: 'かう', meanings: ['买'], partOfSpeech: '动词' },
  { id: 'n5_ja_iku', language: 'ja', headword: '行く', reading: 'いく', meanings: ['去'], partOfSpeech: '动词' },
  { id: 'n5_ja_kuru', language: 'ja', headword: '来る', reading: 'くる', meanings: ['来'], partOfSpeech: '动词' },
  { id: 'n5_ja_kaeru', language: 'ja', headword: '帰る', reading: 'かえる', meanings: ['回'], partOfSpeech: '动词' },
  { id: 'n5_ja_neru', language: 'ja', headword: '寝る', reading: 'ねる', meanings: ['睡'], partOfSpeech: '动词' },
  { id: 'n5_ja_okiru', language: 'ja', headword: '起きる', reading: 'おきる', meanings: ['起床'], partOfSpeech: '动词' },
  { id: 'n5_ja_au', language: 'ja', headword: '会う', reading: 'あう', meanings: ['见面'], partOfSpeech: '动词' },
  { id: 'n5_ja_suru', language: 'ja', headword: 'する', reading: 'する', meanings: ['做'], partOfSpeech: '动词' },
  // ================= 形容词（6） =================
  { id: 'n5_ja_ookii', language: 'ja', headword: '大きい', reading: 'おおきい', meanings: ['大的'], partOfSpeech: '形容词' },
  { id: 'n5_ja_chiisai', language: 'ja', headword: '小さい', reading: 'ちいさい', meanings: ['小的'], partOfSpeech: '形容词' },
  { id: 'n5_ja_atarashii', language: 'ja', headword: '新しい', reading: 'あたらしい', meanings: ['新的'], partOfSpeech: '形容词' },
  { id: 'n5_ja_furui', language: 'ja', headword: '古い', reading: 'ふるい', meanings: ['旧的'], partOfSpeech: '形容词' },
  { id: 'n5_ja_takai', language: 'ja', headword: '高い', reading: 'たかい', meanings: ['高的', '贵的'], partOfSpeech: '形容词' },
  { id: 'n5_ja_yasui', language: 'ja', headword: '安い', reading: 'やすい', meanings: ['便宜的'], partOfSpeech: '形容词' },
  // ================= 寒暄（3） =================
  { id: 'n5_ja_arigatou', language: 'ja', headword: 'ありがとう', reading: 'ありがとう', meanings: ['谢谢'], partOfSpeech: '寒暄语' },
  { id: 'n5_ja_sumimasen', language: 'ja', headword: 'すみません', reading: 'すみません', meanings: ['对不起', '劳驾'], partOfSpeech: '寒暄语' },
  { id: 'n5_ja_onegaishimasu', language: 'ja', headword: 'お願いします', reading: 'おねがいします', meanings: ['拜托了'], partOfSpeech: '寒暄语' },
];
