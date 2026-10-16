interface KanaMemoryVowel {
  kana: string;
  romaji: string;
  hint: string;
}

interface KanaMemoryFamily {
  name: string;
  consonant: string;
  sounds: string;
  note: string;
  audioText: string;
}

interface KanaMemoryKeySound {
  kana: string;
  romaji: string;
  note: string;
}

interface KanaMemoryRule {
  title: string;
  body: string;
}

/**
 * 五十音总原则的结构化内容。
 *
 * 这是给弹窗和后续课程卡片使用的内容资产，不承载任何用户学习状态；
 * 用户的练习记录仍然由 Gateway/SQLite 维护。
 */
export const KANA_MEMORY_GUIDE = {
  vowels: [
    { kana: 'あ', romaji: 'a', hint: '张开口的 a，先把声音立住。' },
    { kana: 'い', romaji: 'i', hint: '嘴角稍微展开的 i，像两条细细的 i。' },
    { kana: 'う', romaji: 'u', hint: '短而收的 u，嘴唇不要过度突出。' },
    { kana: 'え', romaji: 'e', hint: '清楚的 e，用 えき (eki) 做词锚点。' },
    { kana: 'お', romaji: 'o', hint: '口腔更圆的 o，和 あ (a) 并排听。' },
  ] satisfies readonly KanaMemoryVowel[],
  consonantFamilies: [
    {
      name: 'あ行',
      consonant: '没有额外辅音',
      sounds: 'あ (a) · い (i) · う (u) · え (e) · お (o)',
      note: '五个元音，整张表的地基。',
      audioText: 'あいうえお',
    },
    {
      name: 'か行',
      consonant: 'k',
      sounds: 'か (ka) · き (ki) · く (ku) · け (ke) · こ (ko)',
      note: 'k + 五个元音，规律非常整齐。',
      audioText: 'かきくけこ',
    },
    {
      name: 'さ行',
      consonant: 's',
      sounds: 'さ (sa) · し (shi) · す (su) · せ (se) · そ (so)',
      note: 'し (shi) 是例外，不要机械读成 si。',
      audioText: 'さしすせそ',
    },
    {
      name: 'た行',
      consonant: 't',
      sounds: 'た (ta) · ち (chi) · つ (tsu) · て (te) · と (to)',
      note: 'ち (chi)、つ (tsu) 不按 ti、tu 硬套。',
      audioText: 'たちつてと',
    },
    {
      name: 'な行',
      consonant: 'n',
      sounds: 'な (na) · に (ni) · ぬ (nu) · ね (ne) · の (no)',
      note: '声音规律稳定，但 ぬ (nu)/め (me)/ね (ne) 长得很像。',
      audioText: 'なにぬねの',
    },
    {
      name: 'は行',
      consonant: 'h',
      sounds: 'は (ha) · ひ (hi) · ふ (fu) · へ (he) · ほ (ho)',
      note: 'ふ (fu) 是接近 fu 的音，不是中文“夫”的复刻版。',
      audioText: 'はひふへほ',
    },
    {
      name: 'ま行',
      consonant: 'm',
      sounds: 'ま (ma) · み (mi) · む (mu) · め (me) · も (mo)',
      note: '规律稳定，みみ (mimi)、もも (momo) 很适合做词锚点。',
      audioText: 'まみむめも',
    },
    {
      name: 'や行',
      consonant: 'y',
      sounds: 'や (ya) · ゆ (yu) · よ (yo)',
      note: '现代基础表只有三个，别费劲寻找 yi、ye。',
      audioText: 'やゆよ',
    },
    {
      name: 'ら行',
      consonant: 'r',
      sounds: 'ら (ra) · り (ri) · る (ru) · れ (re) · ろ (ro)',
      note: '舌尖轻弹一下，不是英语 r，也不是汉语 l。',
      audioText: 'らりるれろ',
    },
    {
      name: 'わ行',
      consonant: 'w',
      sounds: 'わ (wa) · を (o)',
      note: 'を (o) 现代标准语通常读 o，主要出现在助词里。',
      audioText: 'わを',
    },
    {
      name: '特殊拍',
      consonant: '—',
      sounds: 'ん (n)',
      note: '没有元音的鼻音，单独放在表格最后。',
      audioText: 'ん',
    },
  ] satisfies readonly KanaMemoryFamily[],
  keySounds: [
    { kana: 'し', romaji: 'shi', note: '不要背成 si。' },
    { kana: 'ち', romaji: 'chi', note: '不要背成 ti。' },
    { kana: 'つ', romaji: 'tsu', note: '不要背成 tu，也不要和 し (shi) 混。' },
    { kana: 'ふ', romaji: 'fu', note: '双唇轻触后送气，听音比谐音可靠。' },
    { kana: 'ら', romaji: 'ra', note: '舌尖轻弹，别卷成英语 r。' },
  ] satisfies readonly KanaMemoryKeySound[],
  rules: [
    {
      title: '别背路线，背反应',
      body: '顺着 あいうえお (a i u e o) 背得很顺，不代表单独看到 え (e) 不会失联。要尽早打乱顺序。',
    },
    {
      title: '看和听要双向',
      body: '看到 き (ki) 要能读，听到 ki 也要能找出 き (ki)。只会一个方向，记忆还没闭环。',
    },
    {
      title: '相似字形要组团',
      body: 'さ (sa)/き (ki)、ぬ (nu)/め (me)/ね (ne)、シ (shi)/ツ (tsu) 要并排比较，不要等错到怀疑人生才处理。',
    },
    {
      title: '罗马字是脚手架',
      body: '新学和答错反馈时可以显示，熟练后逐步隐藏。中文谐音只能临时救急，不能当长期读音。',
    },
    {
      title: '把假名放进词里',
      body: 'ね (ne) → ねこ (neko)，か (ka) → かお (kao)。假名一旦开始“有意义”，就不再像一堆散落的密码。',
    },
    {
      title: '少量多次更稳',
      body: '每次 5～10 分钟、每天多次，通常比一次硬坐两个小时更可靠。工作室一轮 10 题，不必每次刷完整表。',
    },
  ] satisfies readonly KanaMemoryRule[],
} as const;
