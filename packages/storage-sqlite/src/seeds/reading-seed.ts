import type { ReadingPassageSet } from '@study-studio/protocol';

export const INITIAL_READING_SEEDS: ReadingPassageSet[] = [
  {
    id: 'read_ai_cafe',
    origin: 'ai',
    title: '静かなカフェで日本語を勉強する',
    topic: '日常生活',
    difficulty: 2,
    language: 'JA',
    sourceLabel: 'AI 生成 · 难度 2 / N4–N5 基础篇',
    body: `先週の土曜日、私は友達の田中さんと一緒に駅前のカフェへ行きました。店の中は静かで、窓の外には桜の木が見えました。

私たちはコーヒーを注文してから、テーブルで日本語の教科書を開きました。田中さんは「助詞の『で』と『に』がまだ難しい」と言いました。私はノートに例文を書いて説明しました。

二時間ほど勉強したあと、私たちは短い散歩をしました。夕方の風は少し冷たかったですが、とても気持ちよかったです。来週もまた同じカフェで会う約束をしました。`,
    questions: [
      {
        id: 'q_ai_cafe_1',
        prompt: '二人はどこで勉強しましたか。',
        options: [
          { key: 'A', text: '図書館' },
          { key: 'B', text: '駅前のカフェ' },
          { key: 'C', text: '学校の教室' },
          { key: 'D', text: '公園のベンチ' },
        ],
        correctAnswer: 'B',
        explanation: '第1段落「駅前のカフェへ行きました」と「テーブルで日本語の教科書を開きました」から正解はB。',
      },
      {
        id: 'q_ai_cafe_2',
        prompt: '田中さんが難しいと言ったのは何ですか。',
        options: [
          { key: 'A', text: '漢字の書き順' },
          { key: 'B', text: '敬語の使い方' },
          { key: 'C', text: '助詞の「で」と「に」' },
          { key: 'D', text: '動词の過去形' },
        ],
        correctAnswer: 'C',
        explanation: '第2段落「助詞の『で』と『に』がまだ難しいと言いました」と明記されている。',
      },
      {
        id: 'q_ai_cafe_3',
        prompt: '勉強のあと、二人は何をしましたか。',
        options: [
          { key: 'A', text: '映画館へ行った' },
          { key: 'B', text: '短い散歩をした' },
          { key: 'C', text: 'すぐに電車で帰宅した' },
          { key: 'D', text: '夕飯を食べに行った' },
        ],
        correctAnswer: 'B',
        explanation: '第3段落「二時間ほど勉強したあと、私たちは短い散歩をしました」とある。',
      },
    ],
  },
  {
    id: 'read_ai_craft',
    origin: 'ai',
    title: '日本の伝統工芸と現代デザインの融合',
    topic: '文化・芸術',
    difficulty: 4,
    language: 'JA',
    sourceLabel: 'AI 生成 · 难度 4 / N2–N1 进阶论说篇',
    body: `長年にわたり受け継がれてきた日本の伝統工芸が、いま新たな転換期を迎えている。少子高齢化やライフスタイルの変化に伴い、漆器や和紙などの需要は一時低迷を余儀なくされていた。

しかし近年、若手職人や現代デザイナーとの協働によって、伝統的な技法を保ちつつ現代の都市生活に馴染むテーブルウェアやインテリア雑貨が次々と誕生している。海外の展示会でも高い評価を受け、単なる「保存」から「持続可能な産業」への脱皮が図られつつある。

伝統の真価とは、過去の様式を頑なに固定することではなく、時代ごとの素材や生活感情としなやかに対話を続ける姿勢にあると言えよう。`,
    questions: [
      {
        id: 'q_ai_craft_1',
        prompt: '伝統工芸の需要が一時低迷した要因として本文で挙げられているものはどれか。',
        options: [
          { key: 'A', text: '海外製品の関税引き下げと原材料の高騰' },
          { key: 'B', text: '少子高齢化と生活様式の変遷' },
          { key: 'C', text: '職人の技術力の低下と教育の不在' },
          { key: 'D', text: '政府による過度な文化保護政策' },
        ],
        correctAnswer: 'B',
        explanation: '第1段落「少子高齢化やライフスタイルの変化に伴い、漆器や和紙などの需要は一時低迷を余儀なくされていた」と対応。',
      },
      {
        id: 'q_ai_craft_2',
        prompt: '近年の伝統工芸の取り組みとして正しいものはどれか。',
        options: [
          { key: 'A', text: '海外市場を排し国内需要のみに特化している' },
          { key: 'B', text: '伝統技法を完全に廃止し全自動化を導入した' },
          { key: 'C', text: '現代デザイナーと協働し現代生活に沿う製品を開発している' },
          { key: 'D', text: '博物館展示のみに目的を限定した' },
        ],
        correctAnswer: 'C',
        explanation: '第2段落「若手職人や現代デザイナーとの協働によって、伝統的な技法を保ちつつ現代の都市生活に馴染むテーブルウェアやインテリア雑貨が次々と誕生している」と合致。',
      },
      {
        id: 'q_ai_craft_3',
        prompt: '筆者が考える「伝統の真価」とはどのようなものか。',
        options: [
          { key: 'A', text: '過去の様式を一切変えずに保存すること' },
          { key: 'B', text: '時代の生活感情としなやかに対話し続けること' },
          { key: 'C', text: '海外の流行に合わせて伝統技法を随時破棄すること' },
          { key: 'D', text: '経済的利益のみを最優先して大量生産すること' },
        ],
        correctAnswer: 'B',
        explanation: '第3段落「過去の様式を頑なに固定することではなく、時代ごとの素材や生活感情としなやかに対話を続ける姿勢にある」と一致。',
      },
    ],
  },
  {
    id: 'read_news_quiet_delivery',
    origin: 'news',
    title: 'Cities Trial Quieter Evening Delivery Routes to Cut Urban Noise',
    topic: 'technology',
    difficulty: 3,
    language: 'EN',
    sourceLabel: '合规精选新闻 · Tech & Urban Transit',
    sourceUrl: 'https://example.com/news/quiet-delivery-pilot',
    body: `Several major metropolitan areas are testing new evening delivery corridors that keep heavy freight vans off residential streets after 8 p.m. City transportation officials report that the pilot aims to curb late-night noise complaints without disrupting the rapid pace of e-commerce logistics.

Participating logistics firms share real-time fleet telemetry with city traffic coordination centers. In return, drivers receive priority access to designated off-street loading bays near transit hubs. Early telemetry results from the first month indicate a 22% reduction in residential acoustic disturbances, although neighborhood store owners note slightly longer delays for restocking perishable goods.

Environmental planners advocate expanding the framework to weekend mornings, while courier unions emphasize the need for clearer safety guidelines for electric cargo bike couriers operating after dusk.`,
    questions: [
      {
        id: 'q_news_quiet_1',
        prompt: 'What is the primary objective of the new evening delivery corridor pilot?',
        options: [
          { key: 'A', text: 'To eliminate online retail shipments completely' },
          { key: 'B', text: 'To reduce neighborhood noise without slowing delivery logistics' },
          { key: 'C', text: 'To raise municipal revenue from freight parking violations' },
          { key: 'D', text: 'To mandate gasoline truck usage exclusively' },
        ],
        correctAnswer: 'B',
        explanation: 'Paragraph 1 explicitly notes: "the pilot aims to curb late-night noise complaints without disrupting the rapid pace of e-commerce logistics."',
      },
      {
        id: 'q_news_quiet_2',
        prompt: 'What benefit do logistics companies receive in exchange for sharing telemetry data?',
        options: [
          { key: 'A', text: 'Direct fuel tax subsidies' },
          { key: 'B', text: 'Priority access to designated off-street loading bays' },
          { key: 'C', text: 'Free electric vehicle fleets' },
          { key: 'D', text: 'Exemption from all speed limits' },
        ],
        correctAnswer: 'B',
        explanation: 'Paragraph 2 states: "In return, drivers receive priority access to designated off-street loading bays near transit hubs."',
      },
      {
        id: 'q_news_quiet_3',
        prompt: 'What concern was raised regarding the current pilot?',
        options: [
          { key: 'A', text: 'Neighborhood stores experienced slight restocking delays for perishable goods' },
          { key: 'B', text: 'Noise disturbances doubled in residential sectors' },
          { key: 'C', text: 'E-commerce logistics collapsed within the first week' },
          { key: 'D', text: 'Subway stations were forced to shut down early' },
        ],
        correctAnswer: 'A',
        explanation: 'Paragraph 2 highlights: "although neighborhood store owners note slightly longer delays for restocking perishable goods."',
      },
    ],
  },
  {
    id: 'read_news_tokyo_green',
    origin: 'news',
    title: '都心部における屋上庭園と「生物回廊」再生への挑戦',
    topic: 'environment',
    difficulty: 3,
    language: 'JA',
    sourceLabel: '合规精选新闻 · 社会与生态快讯',
    sourceUrl: 'https://example.com/news/tokyo-green-corridor',
    body: `東京都心部の大規模再開発において、高層ビルの屋上やテラスを結ぶ「緑の回廊（グリーンコリドー）」構想が急速に進展している。人工的なコンクリート空間に在来種の草木を体系的に植栽することで、都市のヒートアイランド現象の緩和とともに、野鳥や昆虫の生息空間を回復させる試みだ。

先週発表された環境調査報告によると、整備から3年が経過した複合施設周辺では、都心では姿を消しつつあったアゲハチョウや小型野鳥の飛来数が前年比で約35%増加したという。

維持管理コストや台風時の安全対策など解決すべき課題は依然として残るものの、都市の経済性と豊かな生態系を共存させるモデルケースとして、国内外の自治体から熱い視線が注がれている。`,
    questions: [
      {
        id: 'q_news_tokyo_1',
        prompt: '「緑の回廊」構想の主たる狙いは何か。',
        options: [
          { key: 'A', text: 'ビルの建設コストを削減すること' },
          { key: 'B', text: 'ヒートアイランド現象緩和と生息空間の回復' },
          { key: 'C', text: '屋上をすべて農園として食用作物を栽培すること' },
          { key: 'D', text: '野鳥を捕獲して展示施設に移送すること' },
        ],
        correctAnswer: 'B',
        explanation: '第1段落「都市のヒートアイランド現象の緩和とともに、野鳥や昆虫の生息空間を回復させる試みだ」に対応。',
      },
      {
        id: 'q_news_tokyo_2',
        prompt: '環境調査報告で明らかになった効果はどれか。',
        options: [
          { key: 'A', text: 'チョウや小型野鳥の飛来数が約35%増加した' },
          { key: 'B', text: '維持管理コストがゼロになった' },
          { key: 'C', text: '都心の気温が瞬時に10度低下した' },
          { key: 'D', text: '台風の発生自体が抑制された' },
        ],
        correctAnswer: 'A',
        explanation: '第2段落「アゲハチョウや小型野鳥の飛来数が前年比で約35%増加した」と合致。',
      },
      {
        id: 'q_news_tokyo_3',
        prompt: '今後の課題として言及されているものはどれか。',
        options: [
          { key: 'A', text: '管理コストや強風・台風時の安全対策' },
          { key: 'B', text: '市民からの全面的な反対運動' },
          { key: 'C', text: '植栽可能な土壌の世界的枯渇' },
          { key: 'D', text: '野鳥の飛来による飛行機の運休' },
        ],
        correctAnswer: 'A',
        explanation: '第3段落「維持管理コストや台風時の安全対策など解決すべき課題は依然として残る」と明記されている。',
      },
    ],
  },
  {
    id: 'read_ai_ko_cafe',
    origin: 'ai',
    title: '카페에서 한국어를 공부하다',
    topic: '일상생활',
    difficulty: 2,
    language: 'KO',
    sourceLabel: 'AI 생성 · TOPIK I 预备 · 难度 2',
    body: `지난 토요일에 저는 친구 민수와 함께 역 앞 카페에 갔습니다. 가게 안은 조용했고, 창문 밖에는 벚꽃이 보였습니다.

우리는 커피를 주문한 뒤에 테이블에서 한국어 책을 펼쳤습니다. 민수는 「조사 '에서'와 '에'가 아직 어렵다」고 말했습니다. 저는 공책에 예문을 쓰면서 설명했습니다.

두 시간쯤 공부한 후에 우리는 짧은 산책을 했습니다. 저녁 바람은 조금 차가웠지만 기분이 좋았습니다. 다음 주에도 같은 카페에서 만나기로 약속했습니다.`,
    questions: [
      {
        id: 'q_ko_ai_1',
        prompt: '두 사람은 어디에서 공부했습니까?',
        options: [
          { key: 'A', text: '도서관' },
          { key: 'B', text: '역 앞 카페' },
          { key: 'C', text: '학교 교실' },
          { key: 'D', text: '공원 벤치' },
        ],
        correctAnswer: 'B',
        explanation: '「역 앞 카페에 갔습니다」「테이블에서 한국어 책을 펼쳤습니다」라고 나와 있습니다.',
      },
      {
        id: 'q_ko_ai_2',
        prompt: '민수가 어렵다고 한 것은 무엇입니까?',
        options: [
          { key: 'A', text: '한자 읽기' },
          { key: 'B', text: '경어' },
          { key: 'C', text: "조사 '에서'와 '에'" },
          { key: 'D', text: '과거형 만들기' },
        ],
        correctAnswer: 'C',
        explanation: "「조사 '에서'와 '에'가 아직 어렵다」고 명시되어 있습니다.",
      },
      {
        id: 'q_ko_ai_3',
        prompt: '공부한 뒤에 두 사람은 무엇을 했습니까?',
        options: [
          { key: 'A', text: '영화를 봤다' },
          { key: 'B', text: '짧은 산책을 했다' },
          { key: 'C', text: '바로 집에 갔다' },
          { key: 'D', text: '식사를 주문했다' },
        ],
        correctAnswer: 'B',
        explanation: '「두 시간쯤 공부한 후에 우리는 짧은 산책을 했습니다.」',
      },
    ],
  },
];
