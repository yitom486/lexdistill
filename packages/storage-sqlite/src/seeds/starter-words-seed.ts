/**
 * 开箱即用初级词包（日韩各 24 词，英语 24 词）。
 * 自撰中文释义的项目自有数据，不复制 JMdict/Kengdic 任何条目；用户后装词典包与之并存。
 * 日语词一律纯假名表层（可直接进 kana 单词听写）；韩语词为常用表层形（进 hangul 单词）；
 * 英语词为具体名词/基础动词（入门可感），reading 列记简易音标。
 */
export interface StarterWordSeed {
  id: string;
  language: 'ja' | 'ko' | 'en';
  headword: string;
  /** 日语假名读音（韩语无单独读音列，置空）。 */
  reading?: string | undefined;
  meanings: string[];
  partOfSpeech?: string | undefined;
}

export const STARTER_SOURCE_ID = 'study-studio-starter-v1';
export const STARTER_SOURCE_LABEL = '开箱词包';
export const STARTER_LICENSE = 'Project-authored starter vocabulary';

export const STARTER_WORD_SEEDS: StarterWordSeed[] = [
  // ================= 日语（24，纯假名） =================
  { id: 'starter_ja_ame', language: 'ja', headword: 'あめ', reading: 'あめ', meanings: ['雨', '糖果'], partOfSpeech: '名词' },
  { id: 'starter_ja_sakura', language: 'ja', headword: 'さくら', reading: 'さくら', meanings: ['樱花'], partOfSpeech: '名词' },
  { id: 'starter_ja_neko', language: 'ja', headword: 'ねこ', reading: 'ねこ', meanings: ['猫'], partOfSpeech: '名词' },
  { id: 'starter_ja_inu', language: 'ja', headword: 'いぬ', reading: 'いぬ', meanings: ['狗'], partOfSpeech: '名词' },
  { id: 'starter_ja_mizu', language: 'ja', headword: 'みず', reading: 'みず', meanings: ['水'], partOfSpeech: '名词' },
  { id: 'starter_ja_gohan', language: 'ja', headword: 'ごはん', reading: 'ごはん', meanings: ['米饭', '饭'], partOfSpeech: '名词' },
  { id: 'starter_ja_densha', language: 'ja', headword: 'でんしゃ', reading: 'でんしゃ', meanings: ['电车'], partOfSpeech: '名词' },
  { id: 'starter_ja_gakkou', language: 'ja', headword: 'がっこう', reading: 'がっこう', meanings: ['学校'], partOfSpeech: '名词' },
  { id: 'starter_ja_sensei', language: 'ja', headword: 'せんせい', reading: 'せんせい', meanings: ['老师'], partOfSpeech: '名词' },
  { id: 'starter_ja_tomodachi', language: 'ja', headword: 'ともだち', reading: 'ともだち', meanings: ['朋友'], partOfSpeech: '名词' },
  { id: 'starter_ja_kazoku', language: 'ja', headword: 'かぞく', reading: 'かぞく', meanings: ['家人', '家族'], partOfSpeech: '名词' },
  { id: 'starter_ja_tabemono', language: 'ja', headword: 'たべもの', reading: 'たべもの', meanings: ['食物'], partOfSpeech: '名词' },
  { id: 'starter_ja_nomimono', language: 'ja', headword: 'のみもの', reading: 'のみもの', meanings: ['饮料'], partOfSpeech: '名词' },
  { id: 'starter_ja_hon', language: 'ja', headword: 'ほん', reading: 'ほん', meanings: ['书'], partOfSpeech: '名词' },
  { id: 'starter_ja_eiga', language: 'ja', headword: 'えいが', reading: 'えいが', meanings: ['电影'], partOfSpeech: '名词' },
  { id: 'starter_ja_ongaku', language: 'ja', headword: 'おんがく', reading: 'おんがく', meanings: ['音乐'], partOfSpeech: '名词' },
  { id: 'starter_ja_tenki', language: 'ja', headword: 'てんき', reading: 'てんき', meanings: ['天气'], partOfSpeech: '名词' },
  { id: 'starter_ja_kyou', language: 'ja', headword: 'きょう', reading: 'きょう', meanings: ['今天'], partOfSpeech: '名词' },
  { id: 'starter_ja_ashita', language: 'ja', headword: 'あした', reading: 'あした', meanings: ['明天'], partOfSpeech: '名词' },
  { id: 'starter_ja_daigaku', language: 'ja', headword: 'だいがく', reading: 'だいがく', meanings: ['大学'], partOfSpeech: '名词' },
  { id: 'starter_ja_byouin', language: 'ja', headword: 'びょういん', reading: 'びょういん', meanings: ['医院'], partOfSpeech: '名词' },
  { id: 'starter_ja_ginkou', language: 'ja', headword: 'ぎんこう', reading: 'ぎんこう', meanings: ['银行'], partOfSpeech: '名词' },
  { id: 'starter_ja_eki', language: 'ja', headword: 'えき', reading: 'えき', meanings: ['车站'], partOfSpeech: '名词' },
  { id: 'starter_ja_ohayou', language: 'ja', headword: 'おはよう', reading: 'おはよう', meanings: ['早上好'], partOfSpeech: '寒暄语' },
  // ================= 韩语（24） =================
  { id: 'starter_ko_hello', language: 'ko', headword: '안녕하세요', meanings: ['你好（问候语）'], partOfSpeech: '寒暄语' },
  { id: 'starter_ko_thanks', language: 'ko', headword: '감사합니다', meanings: ['谢谢'], partOfSpeech: '寒暄语' },
  { id: 'starter_ko_school', language: 'ko', headword: '학교', meanings: ['学校'], partOfSpeech: '名词' },
  { id: 'starter_ko_book', language: 'ko', headword: '책', meanings: ['书'], partOfSpeech: '名词' },
  { id: 'starter_ko_water', language: 'ko', headword: '물', meanings: ['水'], partOfSpeech: '名词' },
  { id: 'starter_ko_rice', language: 'ko', headword: '밥', meanings: ['米饭'], partOfSpeech: '名词' },
  { id: 'starter_ko_friend', language: 'ko', headword: '친구', meanings: ['朋友'], partOfSpeech: '名词' },
  { id: 'starter_ko_family', language: 'ko', headword: '가족', meanings: ['家人'], partOfSpeech: '名词' },
  { id: 'starter_ko_teacher', language: 'ko', headword: '선생님', meanings: ['老师'], partOfSpeech: '名词' },
  { id: 'starter_ko_music', language: 'ko', headword: '음악', meanings: ['音乐'], partOfSpeech: '名词' },
  { id: 'starter_ko_movie', language: 'ko', headword: '영화', meanings: ['电影'], partOfSpeech: '名词' },
  { id: 'starter_ko_weather', language: 'ko', headword: '날씨', meanings: ['天气'], partOfSpeech: '名词' },
  { id: 'starter_ko_today', language: 'ko', headword: '오늘', meanings: ['今天'], partOfSpeech: '名词' },
  { id: 'starter_ko_tomorrow', language: 'ko', headword: '내일', meanings: ['明天'], partOfSpeech: '名词' },
  { id: 'starter_ko_university', language: 'ko', headword: '대학교', meanings: ['大学'], partOfSpeech: '名词' },
  { id: 'starter_ko_hospital', language: 'ko', headword: '병원', meanings: ['医院'], partOfSpeech: '名词' },
  { id: 'starter_ko_bank', language: 'ko', headword: '은행', meanings: ['银行'], partOfSpeech: '名词' },
  { id: 'starter_ko_station', language: 'ko', headword: '역', meanings: ['车站'], partOfSpeech: '名词' },
  { id: 'starter_ko_cat', language: 'ko', headword: '고양이', meanings: ['猫'], partOfSpeech: '名词' },
  { id: 'starter_ko_dog', language: 'ko', headword: '개', meanings: ['狗'], partOfSpeech: '名词' },
  { id: 'starter_ko_food', language: 'ko', headword: '음식', meanings: ['食物'], partOfSpeech: '名词' },
  { id: 'starter_ko_drink', language: 'ko', headword: '음료수', meanings: ['饮料'], partOfSpeech: '名词' },
  { id: 'starter_ko_subway', language: 'ko', headword: '지하철', meanings: ['地铁'], partOfSpeech: '名词' },
  { id: 'starter_ko_korean', language: 'ko', headword: '한국어', meanings: ['韩语'], partOfSpeech: '名词' },
  // ================= 英语（24，入门具体词） =================
  { id: 'starter_en_water', language: 'en', headword: 'water', reading: '/ˈwɔːtər/', meanings: ['水'], partOfSpeech: '名词' },
  { id: 'starter_en_book', language: 'en', headword: 'book', reading: '/bʊk/', meanings: ['书'], partOfSpeech: '名词' },
  { id: 'starter_en_school', language: 'en', headword: 'school', reading: '/skuːl/', meanings: ['学校'], partOfSpeech: '名词' },
  { id: 'starter_en_teacher', language: 'en', headword: 'teacher', reading: '/ˈtiːtʃər/', meanings: ['老师'], partOfSpeech: '名词' },
  { id: 'starter_en_friend', language: 'en', headword: 'friend', reading: '/frend/', meanings: ['朋友'], partOfSpeech: '名词' },
  { id: 'starter_en_family', language: 'en', headword: 'family', reading: '/ˈfæməli/', meanings: ['家人'], partOfSpeech: '名词' },
  { id: 'starter_en_cat', language: 'en', headword: 'cat', reading: '/kæt/', meanings: ['猫'], partOfSpeech: '名词' },
  { id: 'starter_en_dog', language: 'en', headword: 'dog', reading: '/dɔːɡ/', meanings: ['狗'], partOfSpeech: '名词' },
  { id: 'starter_en_food', language: 'en', headword: 'food', reading: '/fuːd/', meanings: ['食物'], partOfSpeech: '名词' },
  { id: 'starter_en_apple', language: 'en', headword: 'apple', reading: '/ˈæpl/', meanings: ['苹果'], partOfSpeech: '名词' },
  { id: 'starter_en_eat', language: 'en', headword: 'eat', reading: '/iːt/', meanings: ['吃'], partOfSpeech: '动词' },
  { id: 'starter_en_drink', language: 'en', headword: 'drink', reading: '/drɪŋk/', meanings: ['喝'], partOfSpeech: '动词' },
  { id: 'starter_en_love', language: 'en', headword: 'love', reading: '/lʌv/', meanings: ['爱'], partOfSpeech: '动词' },
  { id: 'starter_en_morning', language: 'en', headword: 'morning', reading: '/ˈmɔːrnɪŋ/', meanings: ['早晨'], partOfSpeech: '名词' },
  { id: 'starter_en_night', language: 'en', headword: 'night', reading: '/naɪt/', meanings: ['夜晚'], partOfSpeech: '名词' },
  { id: 'starter_en_today', language: 'en', headword: 'today', reading: '/təˈdeɪ/', meanings: ['今天'], partOfSpeech: '副词' },
  { id: 'starter_en_hello', language: 'en', headword: 'hello', reading: '/həˈloʊ/', meanings: ['你好'], partOfSpeech: '感叹词' },
  { id: 'starter_en_thank', language: 'en', headword: 'thank', reading: '/θæŋk/', meanings: ['感谢'], partOfSpeech: '动词' },
  { id: 'starter_en_happy', language: 'en', headword: 'happy', reading: '/ˈhæpi/', meanings: ['高兴的'], partOfSpeech: '形容词' },
  { id: 'starter_en_big', language: 'en', headword: 'big', reading: '/bɪɡ/', meanings: ['大的'], partOfSpeech: '形容词' },
  { id: 'starter_en_small', language: 'en', headword: 'small', reading: '/smɔːl/', meanings: ['小的'], partOfSpeech: '形容词' },
  { id: 'starter_en_red', language: 'en', headword: 'red', reading: '/red/', meanings: ['红色的'], partOfSpeech: '形容词' },
  { id: 'starter_en_home', language: 'en', headword: 'home', reading: '/hoʊm/', meanings: ['家'], partOfSpeech: '名词' },
  { id: 'starter_en_one', language: 'en', headword: 'one', reading: '/wʌn/', meanings: ['一'], partOfSpeech: '数词' },
];
