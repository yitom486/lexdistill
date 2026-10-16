import { isOk } from '@lexdistill/shared';
import {
  fetchRssItemsWithFallback,
  resolveNewsFeedCandidates,
  type RssItem,
} from '../infrastructure/news-rss.js';
import { fetchNewsArticleFullText } from '../infrastructure/news-article-fetch.js';
import { buildReadingQuestionsFromNews, formatNewsBody } from './news-reading.js';
import {
  type StudyContentLanguage,
  normalizeContentLanguage,
} from './content-language-policy.js';

export interface GeneratedNewsPassage {
  title: string;
  body: string;
  sourceLabel: string;
  sourceUrl?: string | undefined;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ key: string; text: string }>;
    correctAnswer: string;
    explanation: string;
  }>;
  fromRss: boolean;
  /** 是否成功用原文页正文替换了 RSS 摘要 */
  fromFullText: boolean;
  publisher: string;
  /**
   * 结构化来源类型，供 UI 与持久层判定展示与版权策略；
   * 取代过去对 sourceLabel 字符串的脆弱 includes 推断。
   */
  sourceKind: NewsSourceKind;
  /**
   * 抓取状态：ok=成功；network_failed=HTTP/网络失败；empty=源可用但无条目；
   * timeout=超时。仅当 sourceKind==='offline_template' 时才反映整体回退原因。
   */
  fetchStatus: NewsFetchStatus;
  /**
   * 可安全持久化到数据库的正文（P3-B 版权收口）。
   * - news + full_text: 仅 RSS 摘要（不长期存储无授权的第三方整篇正文）
   * - news + rss_summary / offline_template: 与 body 一致
   * 路由据此写入 DB；当前会话仍可经 API 响应的 body 字段返回全文供即时阅读。
   */
  persistBody: string;
}

export type NewsSourceKind = 'full_text' | 'rss_summary' | 'offline_template';
export type NewsFetchStatus = 'ok' | 'network_failed' | 'empty' | 'timeout';

export async function generateNewsPassage(params: {
  setId: string;
  topic: string;
  language: StudyContentLanguage | string;
  /** @internal 确定性单测用；产品调用走全局 fetch */
  fetcher?: typeof fetch;
}): Promise<GeneratedNewsPassage> {
  const { setId, topic } = params;
  const language = normalizeContentLanguage(params.language);
  const candidates = resolveNewsFeedCandidates(topic, language);
  const primaryPublisher = candidates[0]?.publisher ?? 'News';
  const rssRes = await fetchRssItemsWithFallback(candidates, {
    limit: 10,
    ...(params.fetcher ? { fetcher: params.fetcher } : {}),
  });

  if (isOk(rssRes) && rssRes.value.items.length > 0) {
    const { items, feed } = rssRes.value;
    const article: RssItem =
      items[Math.floor(Math.random() * items.length)] ?? items[0]!;

    let fullText: string | undefined;
    let fromFullText = false;
    if (article.link) {
      const fullRes = await fetchNewsArticleFullText(article.link, {
        ...(params.fetcher ? { fetcher: params.fetcher } : {}),
      });
      if (isOk(fullRes) && fullRes.value.fromFullText) {
        fullText = fullRes.value.text;
        fromFullText = true;
      }
    }

    return {
      title: article.title,
      body: formatNewsBody(article, language, { fullText }),
      // 版权收口：DB 只存公开 RSS 摘要，不长期保存无授权的第三方整篇正文。
      persistBody: formatNewsBody(article, language, {}),
      sourceLabel: fromFullText
        ? `${feed.publisher} · 原文摘录 · ${topic}`
        : `${feed.publisher} RSS · ${topic}`,
      ...(article.link ? { sourceUrl: article.link } : {}),
      questions: buildReadingQuestionsFromNews({
        setId,
        language,
        topic,
        article,
        publisher: feed.publisher,
      }),
      fromRss: true,
      fromFullText,
      publisher: feed.publisher,
      sourceKind: fromFullText ? 'full_text' : 'rss_summary',
      fetchStatus: 'ok',
    };
  }

  // 全部 RSS 候选失败：按错误类别映射 fetchStatus，再回退合规模板
  const fallbackStatus: NewsFetchStatus = rssRes && !isOk(rssRes)
    ? rssRes.error.code === 'E_NEWS_RSS_TIMEOUT'
      ? 'timeout'
      : rssRes.error.code === 'E_NEWS_RSS_EMPTY'
        ? 'empty'
        : 'network_failed'
    : 'network_failed';
  return buildOfflineNewsTemplate(setId, language, topic, primaryPublisher, fallbackStatus);
}

function buildOfflineNewsTemplate(
  setId: string,
  language: StudyContentLanguage,
  topic: string,
  publisher: string,
  fetchStatus: NewsFetchStatus
): GeneratedNewsPassage {
  if (language === 'KO') {
    return {
      title: `한국어 뉴스 연습: ${topic}`,
      body: `지금은 공개 뉴스 RSS를 잠시 가져올 수 없어, TOPIK 대비용 한국어 읽기 골격으로 연습합니다.

먼저 제목과 첫 두 문장에서 주장(무엇이 일어났는지)을 찾으세요. 이어서 연결어(그래서, 하지만, 그러나, 또한)가 대조·근거·추가를 어떻게 표시하는지 표시해 보세요.

마지막으로 이 요약이 ${topic}에 대한 분명한 중심 생각을 말하는지, 아니면 사건만 나열하는지 구분하세요. 이 구분이 TOPIK 읽기 문항의 핵심입니다.`,
      sourceLabel: `한국어 학습 템플릿 · ${topic}（RSS 暂不可用：${publisher}）`,
      questions: buildTemplateNewsQuestions(setId, language, topic),
      fromRss: false,
      fromFullText: false,
      publisher,
      sourceKind: 'offline_template',
      fetchStatus,
      persistBody: `지금은 공개 뉴스 RSS를 잠시 가져올 수 없어, TOPIK 대비용 한국어 읽기 골격으로 연습합니다.

먼저 제목과 첫 두 문장에서 주장(무엇이 일어났는지)을 찾으세요. 이어서 연결어(그래서, 하지만, 그러나, 또한)가 대조·근거·추가를 어떻게 표시하는지 표시해 보세요.

마지막으로 이 요약이 ${topic}에 대한 분명한 중심 생각을 말하는지, 아니면 사건만 나열하는지 구분하세요. 이 구분이 TOPIK 읽기 문항의 핵심입니다.`,
    };
  }

  if (language === 'JA') {
    return {
      title: `【快讯】关于${topic}领域的最新发展与社会影响`,
      body: `近年のグローバルな技術革新と社会の変化に伴い、${topic}分野における新たな取り組みが急速に注目を集めている。国内外の専門機関が発表した最新データによれば、関連する市場規模は過去2年間で約30%拡大したという。

市場の成長とともに、ユーザーの利便性向上や業務効率化が実現される一方で、プライバシーの保護や安全性基準の整備といった制度的課題も指摘されている。

関係者は「持続可能な発展を遂げるためには、技術の進化だけでなく、社会全体の倫理規範との調和が不可欠である」と強調している。今後の法整備や官民連携の行方が注目される。`,
      sourceLabel: `合規テンプレート稿 · ${topic}（RSS 暫不可用：${publisher}）`,
      questions: buildTemplateNewsQuestions(setId, language, topic),
      fromRss: false,
      fromFullText: false,
      publisher,
      sourceKind: 'offline_template',
      fetchStatus,
      persistBody: `近年のグローバルな技術革新と社会の変化に伴い、${topic}分野における新たな取り組みが急速に注目を集めている。国内外の専門機関が発表した最新データによれば、関連する市場規模は過去2年間で約30%拡大したという。

市場の成長とともに、ユーザーの利便性向上や業務効率化が実現される一方で、プライバシーの保護や安全性基準の整備といった制度的課題も指摘されている。

関係者は「持続可能な発展を遂げるためには、技術の進化だけでなく、社会全体の倫理規範との調和が不可欠である」と強調している。今後の法整備や官民連携の行方が注目される。`,
    };
  }

  return {
    title: `English Media Briefing: ${topic}`,
    body: `Authentic English news on ${topic} is temporarily unavailable, so this curated briefing keeps your reading practice going.

First, identify the writer's claim in the opening lines. Next, notice discourse markers (however, meanwhile, according to) that signal contrast or evidence — these matter more than translating every noun into Chinese.

Finally, check whether the summary supports a clear main idea about ${topic}, or merely lists events. That distinction is central to CET and Kaoyan reading items.`,
    sourceLabel: `English study template · ${topic} (RSS unavailable: ${publisher})`,
    questions: buildTemplateNewsQuestions(setId, language, topic),
    fromRss: false,
    fromFullText: false,
    publisher,
    sourceKind: 'offline_template',
    fetchStatus,
    persistBody: `Authentic English news on ${topic} is temporarily unavailable, so this curated briefing keeps your reading practice going.

First, identify the writer's claim in the opening lines. Next, notice discourse markers (however, meanwhile, according to) that signal contrast or evidence — these matter more than translating every noun into Chinese.

Finally, check whether the summary supports a clear main idea about ${topic}, or merely lists events. That distinction is central to CET and Kaoyan reading items.`,
  };
}

function buildTemplateNewsQuestions(
  setId: string,
  language: StudyContentLanguage,
  topic: string
) {
  if (language === 'KO') {
    return [
      {
        id: `${setId}_q1`,
        prompt: `이 ${topic} 연습 글의 일차 읽기 목표는 무엇인가요?`,
        options: [
          {
            key: 'A',
            text: '중심 주장과 연결어가 표시하는 근거·대조를 찾기',
          },
          {
            key: 'B',
            text: '모든 단어를 중국어로 직역한 뒤에야 이해하기',
          },
          {
            key: 'C',
            text: '고유명사만 외우고 문장 구조는 무시하기',
          },
          {
            key: 'D',
            text: '요약에 사실 내용이 없다고 가정하기',
          },
        ],
        correctAnswer: 'A',
        explanation:
          'TOPIK 읽기는 중심 생각 + 담화 표지 파악이 핵심이며, 단어별 직역보다 문맥을 우선합니다.',
      },
      {
        id: `${setId}_q2`,
        prompt: '뉴스형 글을 읽을 때 가장 도움이 되는 습관은?',
        options: [
          {
            key: 'A',
            text: '제목→앞부분→연결어 순으로 훑은 뒤 세부 확인',
          },
          {
            key: 'B',
            text: '중간부터 임의로 뛰어 읽기',
          },
          {
            key: 'C',
            text: '한 문장도 건너뛰지 않고 사전만 찾기',
          },
          {
            key: 'D',
            text: '출처 링크는 절대 열어보지 않기',
          },
        ],
        correctAnswer: 'A',
        explanation: '스키밍으로 주제를 잡은 뒤 세부·출처를 확인하면 효율이 높습니다.',
      },
      {
        id: `${setId}_q3`,
        prompt: '이 골격 자료의 역할로 맞는 것은?',
        options: [
          {
            key: 'A',
            text: '공개 RSS가 잠시 실패했을 때의 학습용 임시 본문',
          },
          {
            key: 'B',
            text: '영구적으로 진짜 한국어 뉴스를 대체하는 공식 원문',
          },
          {
            key: 'C',
            text: '검열된 광고 문구만 모은 목록',
          },
          {
            key: 'D',
            text: '시험 채점 기준표 그 자체',
          },
        ],
        correctAnswer: 'A',
        explanation: 'RSS 복구 후에는 연합뉴스 등 공개 원문으로 다시 연습하세요.',
      },
    ];
  }

  if (language !== 'JA') {
    return [
      {
        id: `${setId}_q1`,
        prompt: `What is the primary reading goal for this English briefing on ${topic}?`,
        options: [
          {
            key: 'A',
            text: 'Find the main claim and how evidence is signalled in the paragraph',
          },
          {
            key: 'B',
            text: 'Translate every word into Chinese before understanding the sentence',
          },
          {
            key: 'C',
            text: 'Ignore discourse markers and focus only on rare proper nouns',
          },
          {
            key: 'D',
            text: 'Assume the summary has no factual content at all',
          },
        ],
        correctAnswer: 'A',
        explanation:
          'English-exam reading rewards main-idea + discourse structure over word-by-word Chinglish translation.',
      },
      {
        id: `${setId}_q2`,
        prompt: 'Which habit best reduces Chinglish interference while reading news?',
        options: [
          {
            key: 'A',
            text: 'Track collocations and connectors in context before translating',
          },
          {
            key: 'B',
            text: 'Force Chinese word order onto every English sentence',
          },
          {
            key: 'C',
            text: 'Skip the headline and jump randomly into the middle',
          },
          {
            key: 'D',
            text: 'Treat every proper noun as more important than the claim',
          },
        ],
        correctAnswer: 'A',
        explanation:
          'Collocations and discourse markers carry meaning that word-by-word translation often erases.',
      },
      {
        id: `${setId}_q3`,
        prompt: 'What should you do when the live RSS feed returns?',
        options: [
          {
            key: 'A',
            text: 'Switch back to authentic English media with a source link',
          },
          {
            key: 'B',
            text: 'Keep using only this offline template forever',
          },
          {
            key: 'C',
            text: 'Ignore publisher labels and trust anonymous reposts',
          },
          {
            key: 'D',
            text: 'Stop checking whether the summary matches the headline',
          },
        ],
        correctAnswer: 'A',
        explanation: 'Templates keep practice going; authentic RSS + full-text is the preferred path.',
      },
    ];
  }

  return [
    {
      id: `${setId}_q1`,
      prompt: 'この練習文の主題として最も適切なものはどれか。',
      options: [
        { key: 'A', text: `${topic}分野の動向と社会的影響` },
        { key: 'B', text: '天気予報のみの速報' },
        { key: 'C', text: 'スポーツの試合結果一覧' },
        { key: 'D', text: '広告メールの件名' },
      ],
      correctAnswer: 'A',
      explanation: 'オフライン原稿は当該トピックの論説骨格である。',
    },
    {
      id: `${setId}_q2`,
      prompt: '本文で指摘されている課題に近いものはどれか。',
      options: [
        { key: 'A', text: 'プライバシー保護や安全性基準の整備' },
        { key: 'B', text: 'すべての研究の全面禁止' },
        { key: 'C', text: '報道の全面停止' },
        { key: 'D', text: '語彙学習の廃止' },
      ],
      correctAnswer: 'A',
      explanation: '成長の一方で制度的課題が述べられている。',
    },
    {
      id: `${setId}_q3`,
      prompt: 'この資料の位置づけとして正しいものはどれか。',
      options: [
        { key: 'A', text: 'RSS 不通時の学習用テンプレート' },
        { key: 'B', text: '公式統計の一次資料そのもの' },
        { key: 'C', text: '匿名掲示板の転載のみ' },
        { key: 'D', text: '未検証の個人ブログ' },
      ],
      correctAnswer: 'A',
      explanation: '通信復旧後は NHK 等の公開 RSS・原文へ戻る。',
    },
  ];
}
