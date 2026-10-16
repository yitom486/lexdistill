import type { KanaExampleWord, KanaItem, KanaScriptLearningGuide } from '@lexdistill/protocol';
import { HIRAGANA_SHAPES } from './kana-shape-hiragana.js';
import { KATAKANA_SHAPES } from './kana-shape-katakana.js';
import type { KanaShapeEntry } from './kana-shape-types.js';

const KATAKANA_WORDS: Record<string, readonly [string, string]> = {
  ア: ['アイス', '冰淇淋'], イ: ['インク', '墨水'], ウ: ['ウイルス', '病毒'],
  エ: ['エアコン', '空调'], オ: ['オレンジ', '橙子'], カ: ['カメラ', '相机'],
  キ: ['キス', '吻'], ク: ['クラス', '班级'], ケ: ['ケーキ', '蛋糕'],
  コ: ['コーヒー', '咖啡'], サ: ['サラダ', '沙拉'], シ: ['シーツ', '床单'],
  ス: ['スープ', '汤'], セ: ['セーター', '毛衣'], ソ: ['ソファ', '沙发'],
  タ: ['タクシー', '出租车'], チ: ['チーズ', '奶酪'], ツ: ['ツアー', '旅行团／游览'],
  テ: ['テスト', '测验'], ト: ['トマト', '番茄'], ナ: ['ナイフ', '刀'],
  ニ: ['ニュース', '新闻'], ヌ: ['カヌー', '独木舟'], ネ: ['ネクタイ', '领带'],
  ノ: ['ノート', '笔记本'], ハ: ['ハンカチ', '手帕'], ヒ: ['ヒント', '提示'],
  フ: ['フォーク', '餐叉'], ヘ: ['ヘルメット', '头盔'], ホ: ['ホテル', '酒店'],
  マ: ['マスク', '口罩'], ミ: ['ミルク', '牛奶'], ム: ['ゲーム', '游戏'],
  メ: ['メニュー', '菜单'], モ: ['モデル', '模特／模型'], ヤ: ['タイヤ', '轮胎'],
  ユ: ['ユニフォーム', '制服'], ヨ: ['ヨーグルト', '酸奶'], ラ: ['ラジオ', '收音机'],
  リ: ['リモコン', '遥控器'], ル: ['ルール', '规则'], レ: ['レモン', '柠檬'],
  ロ: ['ロボット', '机器人'], ワ: ['ワイン', '葡萄酒'], ン: ['パン', '面包'],
  ガ: ['ガラス', '玻璃'], ギ: ['ギター', '吉他'], グ: ['グラス', '玻璃杯'],
  ゲ: ['ゲーム', '游戏'], ゴ: ['ゴール', '终点／进球'], ザ: ['ピザ', '披萨'],
  ジ: ['ジュース', '果汁'], ズ: ['ズボン', '裤子'], ゼ: ['ゼロ', '零'],
  ゾ: ['ゾーン', '区域'], ダ: ['ダンス', '舞蹈'], デ: ['デパート', '百货商店'],
  ド: ['ドア', '门'], バ: ['バス', '公交车'], ビ: ['ビル', '大楼'],
  ブ: ['ブラシ', '刷子'], ベ: ['ベッド', '床'], ボ: ['ボール', '球'],
  パ: ['パン', '面包'], ピ: ['ピアノ', '钢琴'], プ: ['プール', '游泳池'],
  ペ: ['ペン', '笔'], ポ: ['ポスト', '邮筒'],
  キャ: ['キャベツ', '卷心菜'], キュ: ['キューブ', '立方体'], キョ: ['キョロキョロ', '东张西望'],
  シャ: ['シャツ', '衬衫'], シュ: ['シュート', '射门'], ショ: ['ショート', '短的'],
  チャ: ['チャイム', '铃声'], チュ: ['チューブ', '管子'], チョ: ['チョコ', '巧克力'],
  ニュ: ['ニュース', '新闻'], ミュ: ['ミュージック', '音乐'], リュ: ['リュック', '背包'],
  ギャ: ['ギャラリー', '画廊'], ギュ: ['ギュッ', '紧紧地（拟态词）'],
  ジャ: ['ジャム', '果酱'], ジュ: ['ジュース', '果汁'], ジョ: ['ジョギング', '慢跑'],
  ピュ: ['ピューマ', '美洲狮'],
};

type Script = 'hiragana' | 'katakana';

/** 字形内容逐字维护，只有浊点和拗音等确实共用的组成规则在这里复用。 */
export function buildKanaScriptGuides(
  kana: KanaItem,
  pool: readonly KanaItem[],
  examples: KanaExampleWord[],
): { hiragana: KanaScriptLearningGuide; katakana: KanaScriptLearningGuide } {
  const build = (script: Script): KanaScriptLearningGuide => {
    const face = kana[script];
    const reading = kana.hiragana === 'を' ? 'o（助词；表中罗马字 wo）'
      : kana.hiragana === 'ぢ' ? 'ji（表中罗马字 dji）'
      : kana.hiragana === 'づ' ? 'zu（表中罗马字 dzu）' : kana.romaji;
    const shapes = script === 'hiragana' ? HIRAGANA_SHAPES : KATAKANA_SHAPES;
    // NFD 只拆浊点，不会把小ゃ/ゅ/ょ当作另一个完整音拍。
    const baseFace = face[0]!.normalize('NFD')[0]!;
    const entry: KanaShapeEntry | undefined = shapes[baseFace];
    if (!entry) throw new Error(`Missing kana shape guide: ${face}`);
    const comparison = pool.find((item) => item[script] === entry[4]);
    if (!comparison) throw new Error(`Missing kana contrast: ${face} / ${entry[4]}`);
    const word = script === 'katakana' ? KATAKANA_WORDS[face] : undefined;
    const exampleWords = word
      ? [{ word: word[0], reading: word[0], meaning: word[1] }]
      : examples;
    let shapeFeatures = [entry[0], entry[1]];
    let memoryTip = entry[2];
    let recognitionCue = entry[3];
    let contrasts = [{ kana: entry[4], romaji: comparison.romaji, difference: entry[5] }];

    if (kana.type === 'DAKUON' || kana.type === 'HANDAKUON') {
      const base = pool.find((item) => item[script] === baseFace)!;
      const circle = kana.type === 'HANDAKUON';
      const mark = circle ? '一个小圆圈' : '两根短浊点';
      shapeFeatures = [entry[0], entry[1], `主体是「${baseFace}」，右上增加${mark}。`];
      memoryTip = `先用清音的图像找主体：${entry[2]} 然后单独检查右上${mark}，把读音换成 ${kana.romaji}。`;
      recognitionCue = `${baseFace}的主体＋右上${mark}。`;
      contrasts = [{ kana: baseFace, romaji: base.romaji, difference: `主体相同；${face}右上有${mark}，${baseFace}没有。读音是 ${kana.romaji} / ${base.romaji}，别漏看标记。` }];
      const counterpart = pool.find((item) => item.type === (circle ? 'DAKUON' : 'HANDAKUON')
        && item[script].normalize('NFD')[0] === baseFace);
      if (counterpart) contrasts.push({
        kana: counterpart[script], romaji: counterpart.romaji,
        difference: `右上两短点表示 b 行，小圆圈表示 p 行；${face}是 ${kana.romaji}，${counterpart[script]}是 ${counterpart.romaji}。`,
      });
      if (kana.hiragana === 'ぢ' || kana.hiragana === 'づ') {
        const same = pool.find((item) => item.hiragana === (kana.hiragana === 'ぢ' ? 'じ' : 'ず'))!;
        contrasts.push({ kana: same[script], romaji: same.romaji,
          difference: `现代标准日语通常同音或近同音；${face}从${baseFace}加浊点而来，拼写要随词记，不能靠听音硬猜。` });
      }
    }

    if (kana.type === 'YOON') {
      const large = face.slice(0, -1);
      const small = face.slice(-1);
      const fullSize = String.fromCharCode(small.charCodeAt(0) + 1);
      const base = pool.find((item) => item[script] === large)!;
      const fullItem = pool.find((item) => item[script] === fullSize)!;
      const voiced = large !== baseFace ? '先检查大字右上的浊点或圆圈。' : '';
      shapeFeatures = [`大字「${large}」看主体：${entry[3]}${voiced}`,
        `后面的「${small}」明显小于「${fullSize}」；两字合成一拍，不拆成两拍。`];
      memoryTip = `把「${large}」当主角，小「${small}」当贴在旁边的小标签。主角的图像：${entry[2]} 标签小，读音连起来是 ${kana.romaji}，中间不停车。`;
      recognitionCue = `先认大${large}，再看小${small}；合成一拍 ${kana.romaji}。`;
      contrasts = [{ kana: `${large}${fullSize}`, romaji: `${base.romaji}-${fullItem.romaji}`,
        difference: `${face}用小${small}，合成一拍；${large}${fullSize}用大${fullSize}，分别读两拍。区别在大小与节拍，不只是音量。` }];
    }

    return {
      shapeFeatures, memoryTip, recognitionCue, contrasts, exampleWords,
      recallQuestion: `只看「${face}」：读什么？最先看哪一处？与「${contrasts[0]!.kana}」怎么区分？先自己说，再揭晓。`,
      recallAnswer: `「${face}」读 ${reading}。辨认口令：${recognitionCue} ${contrasts[0]!.difference}`,
    };
  };
  return { hiragana: build('hiragana'), katakana: build('katakana') };
}
