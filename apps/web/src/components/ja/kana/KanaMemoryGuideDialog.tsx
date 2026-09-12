import React from 'react';
import { ArrowRight, BookOpen, GitCompareArrows, Info, Lightbulb, Sparkles } from 'lucide-react';

import { Badge } from '../../ui/badge.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';

import { KanaGuideSpeakButton } from './KanaGuideSpeakButton.js';

export interface KanaMemoryGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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


function GuideSectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-wash-amber-500o15 text-accent-ink-strong">
        <Sparkles className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-ink-strong">
          {eyebrow}
        </p>
        <h3 className="mt-0.5 text-lg font-serif font-bold text-ink">
          {title}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          {description}
        </p>
      </div>
    </div>
  );
}

export function KanaMemoryGuideDialog({ open, onOpenChange }: KanaMemoryGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="shrink-0 border-b border-line-amber-900o10 bg-linear-to-br from-grad-amber-50-amber-950o40 via-paper-soft to-grad-orange-50-orange-950o30 p-5 pr-12 dark:border-wash-amber-500o15 sm:p-7 sm:pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="amber" className="gap-1">
                <BookOpen className="h-3 w-3" />
                五十音记忆法
              </Badge>
              <span className="text-[11px] font-mono text-ink-ghost">
                先看地图，再开始练
              </span>
            </div>
            <DialogTitle className="mt-2 text-2xl leading-tight sm:text-3xl">
              五十音，其实没有你想的那么多
            </DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-relaxed">
              它不是 46 个需要排队挨个背的陌生符号，而是一套“元音打地基、辅音来组队”的声音地图。
              先看懂这张地图，记忆就不会变成和表格硬碰硬。
            </DialogDescription>
          </DialogHeader>

          <nav
            aria-label="五十音记忆法大纲"
            className="flex shrink-0 gap-2 overflow-x-auto border-b border-line-stone-200o80 bg-veil-whiteo70-stone-950o30 px-5 py-3 dark:border-tone-stone-800 sm:px-7"
          >
            {[
              ['kana-guide-vowels', '五个元音'],
              ['kana-guide-families', '辅音家族'],
              ['kana-guide-map', '行和段'],
              ['kana-guide-origin', '假名家谱'],
              ['kana-guide-rules', '记忆诀窍'],
              ['kana-guide-changes', '后续变化'],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="shrink-0 rounded-full border border-ink-stone-200 bg-tone-white px-3 py-1.5 text-xs font-semibold text-tone-stone-600 transition-colors hover:border-tone-amber-500o40 hover:bg-wash-amber-500o10 hover:text-ink-amber-800 dark:border-tone-stone-700 dark:bg-tone-stone-900 dark:text-tone-stone-300 dark:hover:text-ink-amber-200"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="min-h-0 overflow-y-auto bg-paper-clean p-4 sm:p-7">
            <div className="mx-auto flex max-w-4xl flex-col gap-5">
              <section
                id="kana-guide-vowels"
                className="scroll-mt-4 rounded-3xl border border-tone-amber-500o25 bg-wash-amber-500o10 p-4 dark:bg-wash-amber-500o10 sm:p-5"
              >
                <GuideSectionTitle
                  eyebrow="地基"
                  title="先认识五个元音"
                  description="あ行不是普通的一行，它是五个元音本身。后面的辅音家族都会拿这五个声音来组合。"
                />
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {KANA_MEMORY_GUIDE.vowels.map((vowel) => (
                    <div
                      key={vowel.kana}
                      className="rounded-2xl border border-tone-amber-500o20 bg-veil-whiteo75-stone-900o45 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-3xl font-serif font-bold text-ink">
                            {vowel.kana}
                          </div>
                          <div className="mt-0.5 font-mono text-xs font-bold text-accent-ink-strong">
                            {vowel.romaji}
                          </div>
                        </div>
                        <KanaGuideSpeakButton
                          text={vowel.kana}
                          label={`播放 ${vowel.kana}（${vowel.romaji}）发音`}
                        />
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                        {vowel.hint}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-tone-amber-500o20 bg-veil-whiteo55-stone-900o35 p-3 text-xs leading-relaxed text-tone-stone-700 dark:text-ink-stone-200">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-ink" />
                  <p>
                    把它们当成五个固定插座：`か (ka)` 是 `k + a`，`き (ki)` 是 `k + i`。所以先把
                    `a / i / u / e / o` 听稳，后面每一行都会轻松很多。
                  </p>
                </div>
              </section>

              <section
                id="kana-guide-families"
                className="scroll-mt-4 rounded-3xl border border-ink-stone-200 bg-veil-whiteo70-stone-900o35 p-4 dark:border-tone-stone-800 sm:p-5"
              >
                <GuideSectionTitle
                  eyebrow="组队"
                  title="辅音家族按这个顺序排队"
                  description="记住这条队伍就行：k → s → t → n → h → m → y → r → w。它们不是汉语声母的复制品，而是帮助你看懂规律的家族标签。"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  {KANA_MEMORY_GUIDE.consonantFamilies.map((family) => (
                    <div
                      key={family.name}
                      className="rounded-2xl border border-line-stone-200o80-stone-700o80 bg-surface-paper-abyss p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0 text-[11px]">
                            {family.name}
                          </Badge>
                          <span className="truncate text-[11px] font-mono text-ink-ghost">
                            {family.consonant}
                          </span>
                        </div>
                        <KanaGuideSpeakButton
                          text={family.audioText}
                          label={`播放${family.name}发音`}
                        />
                      </div>
                      <p className="mt-2 text-sm font-serif font-semibold tracking-wide text-ink">
                        {family.sounds}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                        {family.note}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section id="kana-guide-map" className="scroll-mt-4">
                <GuideSectionTitle
                  eyebrow="坐标"
                  title="“行”和“段”只是坐标，不是新怪兽"
                  description="不同教材可能横着排或竖着排，不必纠结方向。看懂“谁是一家人”和“最后落在哪个元音”就够了。"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-3xl border border-line-sky-500o20 bg-wash-sky-500o10 p-4 dark:bg-wash-sky-500o10">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-sky-900-sky-200">
                      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-wash-sky-500o15">行</span>
                      行 = 辅音家族
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-ink-mute-deep">
                      `か行`里的 `か (ka) / き (ki) / く (ku) / け (ke) / こ (ko)` 都带着 k 这个家族特征，后面的元音在变化。
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-sm font-mono font-bold text-ink-sky-800-sky-200">
                      <span>k + a</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>か (ka)</span>
                    </div>
                  </div>
                  <div className="rounded-3xl border border-line-violet-500o20 bg-wash-violet-500o10 p-4 dark:bg-wash-violet-500o10">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-violet-900-violet-200">
                      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-wash-violet-500o15">段</span>
                      段 = 元音位置
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-ink-mute-deep">
                      `あ段`里最后都是 a：`あ (a) / か (ka) / さ (sa) / た (ta) / な (na)`。`い段`则都落在 i。
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-sm font-mono font-bold text-ink-violet-800-violet-200">
                      <span>同一个元音</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>一列亲戚</span>
                    </div>
                  </div>
                </div>
              </section>

              <section
                id="kana-guide-origin"
                className="scroll-mt-4 rounded-3xl border border-line-orange-500o20 bg-wash-orange-500o10 p-4 dark:bg-wash-orange-500o10 sm:p-5"
              >
                <GuideSectionTitle
                  eyebrow="假名家谱"
                  title="它们不是凭空长出来的"
                  description="日本早期有日语，但没有本土文字。汉字传入后，日本人先借汉字记意思，再借汉字的声音记日语，最后才把字形越写越轻。"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-line-orange-500o15 bg-veil-whiteo60-stone-900o35 p-3">
                    <p className="text-xs font-bold text-ink-orange-900-orange-200">汉字先来</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">
                      汉字传入日本后，既拿来记意思，也拿来暂时借声音。这种借音写法叫万叶假名。
                    </p>
                  </div>
                  <div className="rounded-2xl border border-line-orange-500o15 bg-veil-whiteo60-stone-900o35 p-3">
                    <p className="text-xs font-bold text-ink-orange-900-orange-200">平假名出现</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">
                      汉字草书越写越顺，慢慢变成圆润的平假名。例如 `あ (a)` 来自 `安` 的草书。
                    </p>
                  </div>
                  <div className="rounded-2xl border border-line-orange-500o15 bg-veil-whiteo60-stone-900o35 p-3">
                    <p className="text-xs font-bold text-ink-orange-900-orange-200">片假名分家</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-mute">
                      汉字切下一小片做标记，长成片假名。例如 `カ (ka)` 来自 `加` 的一部分。
                    </p>
                  </div>
                </div>
                <p className="mt-4 rounded-2xl border border-line-orange-500o15 bg-veil-whiteo55-stone-900o35 p-3 text-xs leading-relaxed text-tone-stone-700 dark:text-ink-stone-200">
                  所以平假名和片假名是同一套声音的两套衣服，不是 46 + 46 个新声音。五十音表后来又受汉字音韵学和梵文/悉昙排列影响，才整理成今天这张声音地图。
                </p>
              </section>

              <section
                id="kana-guide-rules"
                className="scroll-mt-4 rounded-3xl border border-line-emerald-500o20 bg-wash-emerald-500o10 p-4 dark:bg-wash-emerald-500o10 sm:p-5"
              >
                <GuideSectionTitle
                  eyebrow="真正的诀窍"
                  title="别和表格硬碰硬，和记忆合作"
                  description="你不需要一口气背完。让声音、字形、词例和间隔回忆互相帮忙，才是比较省力的路线。"
                />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {KANA_MEMORY_GUIDE.rules.map((rule) => (
                    <div
                      key={rule.title}
                      className="rounded-2xl border border-tone-emerald-500o15 bg-veil-whiteo65-stone-900o35 p-3"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-ink-emerald-900-emerald-200">
                        <Lightbulb className="h-3.5 w-3.5" />
                        {rule.title}
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
                        {rule.body}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section id="kana-guide-changes" className="scroll-mt-4">
                <GuideSectionTitle
                  eyebrow="下一步"
                  title="基础表学稳，再给声音加装配件"
                  description="浊音、半浊音、拗音、促音和长音都建立在基础假名上。先认识本体，再解锁变形，不用第一天全套带走。"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-3xl border border-line-rose-500o20 bg-wash-rose-500o10 p-4 dark:bg-wash-rose-500o10">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-rose-900-rose-200">
                      <span className="rounded-xl bg-wash-rose-500o15 px-2 py-1">゛ ゜</span>
                      加点之后会变声
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-ink-mute-deep">
                      `か (ka) → が (ga)`，`は (ha) → ば (ba) / ぱ (pa)`。两点是浊音，小圆圈是半浊音 p。
                    </p>
                  </div>
                  <div className="rounded-3xl border border-line-indigo-500o20 bg-wash-indigo-500o10 p-4 dark:bg-wash-indigo-500o10">
                    <div className="flex items-center gap-2 text-sm font-bold text-ink-indigo-900-indigo-200">
                      <span className="rounded-xl bg-wash-indigo-500o15 px-2 py-1">ゃ ゅ ょ</span>
                      小字挤在一起读
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-ink-mute-deep">
                      `きや (kiya)` 是两拍，`きゃ (kya)` 是一组拗音。看到小 `ゃ (ya)`、`ゅ (yu)`、`ょ (yo)`，不要按完整的 `や (ya)`、`ゆ (yu)`、`よ (yo)` 拆开读。
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-3xl border border-tone-amber-500o25 bg-wash-amber-500o10 p-4 dark:bg-wash-amber-500o10">
                  <div className="flex items-center gap-2 text-sm font-bold text-ink-amber-900-amber-200">
                    <GitCompareArrows className="h-4 w-4" />
                    这些音，建议直接点一下听
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {KANA_MEMORY_GUIDE.keySounds.map((item) => (
                      <div
                        key={item.kana}
                        className="flex items-center gap-1.5 rounded-2xl border border-tone-amber-500o20 bg-veil-whiteo70-stone-900o45 px-2.5 py-1.5"
                      >
                        <span className="font-serif text-base font-bold text-ink">
                          {item.kana}
                        </span>
                        <span className="font-mono text-[11px] text-accent-ink-strong">
                          ({item.romaji})
                        </span>
                        <KanaGuideSpeakButton
                          text={item.kana}
                          label={`播放 ${item.kana}（${item.romaji}）发音`}
                        />
                        <span className="hidden text-[10px] text-ink-ghost sm:inline">
                          {item.note}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                    罗马字可以帮你搭桥，但耳朵才是最后验收员。尤其是 `し (shi)`、`ち (chi)`、`つ (tsu)`、`ふ (fu)` 和 `ら (ra)`，不要只看字母猜声音。
                  </p>
                </div>
              </section>

              <div className="flex items-start gap-2 rounded-2xl border border-ink-stone-200 bg-veil-whiteo70-stone-900o30 p-3 text-[11px] leading-relaxed text-ink-stone-500 dark:border-tone-stone-800 dark:text-ink-stone-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  看完这张地图，就可以回到矩阵做一轮短练习。错了不用气馁：错误会告诉系统下一次该把哪个假名请回来复习。
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
