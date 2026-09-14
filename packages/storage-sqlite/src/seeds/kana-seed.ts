import type { KanaExampleWord, KanaItem, KanaLearningGuide } from '@study-studio/protocol';

/** 例词只用于点击讲义中的认读示范，不把假名误当成独立词义。 */
function example(word: string, reading: string, meaning: string): KanaExampleWord {
  return { word, reading, meaning };
}

/**
 * 课程底座中的安全、短小例词。真正的词义来自完整单词或短语，而不是单个假名。
 */
const KANA_EXAMPLES: Record<string, KanaExampleWord[]> = {
  kana_a: [example('朝', 'あさ', '早上')],
  kana_i: [example('犬', 'いぬ', '狗')],
  kana_u: [example('海', 'うみ', '海')],
  kana_e: [example('駅', 'えき', '车站')],
  kana_o: [example('お茶', 'おちゃ', '茶')],
  kana_ka: [example('傘', 'かさ', '雨伞')],
  kana_ki: [example('木', 'き', '树')],
  kana_ku: [example('車', 'くるま', '汽车')],
  kana_ke: [example('今朝', 'けさ', '今天早上')],
  kana_ko: [example('ここ', 'ここ', '这里')],
  kana_sa: [example('魚', 'さかな', '鱼')],
  kana_shi: [example('塩', 'しお', '盐')],
  kana_su: [example('寿司', 'すし', '寿司')],
  kana_se: [example('先生', 'せんせい', '老师')],
  kana_so: [example('空', 'そら', '天空')],
  kana_ta: [example('卵', 'たまご', '鸡蛋')],
  kana_chi: [example('地図', 'ちず', '地图')],
  kana_tsu: [example('月', 'つき', '月亮')],
  kana_te: [example('手', 'て', '手')],
  kana_to: [example('友達', 'ともだち', '朋友')],
  kana_na: [example('名前', 'なまえ', '名字')],
  kana_ni: [example('日本', 'にほん', '日本')],
  kana_nu: [example('布', 'ぬの', '布')],
  kana_ne: [example('猫', 'ねこ', '猫')],
  kana_no: [example('飲む', 'のむ', '喝')],
  kana_ha: [example('花', 'はな', '花')],
  kana_hi: [example('飛行機', 'ひこうき', '飞机')],
  kana_fu: [example('船', 'ふね', '船')],
  kana_he: [example('部屋', 'へや', '房间')],
  kana_ho: [example('本', 'ほん', '书')],
  kana_ma: [example('窓', 'まど', '窗户')],
  kana_mi: [example('水', 'みず', '水')],
  kana_mu: [example('虫', 'むし', '昆虫')],
  kana_me: [example('眼鏡', 'めがね', '眼镜')],
  kana_mo: [example('森', 'もり', '森林')],
  kana_ya: [example('山', 'やま', '山')],
  kana_yu: [example('雪', 'ゆき', '雪')],
  kana_yo: [example('夜', 'よる', '夜晚')],
  kana_ra: [example('来月', 'らいげつ', '下个月')],
  kana_ri: [example('林檎', 'りんご', '苹果')],
  kana_ru: [example('留守', 'るす', '不在')],
  kana_re: [example('歴史', 'れきし', '历史')],
  kana_ro: [example('六', 'ろく', '六')],
  kana_wa: [example('私', 'わたし', '我')],
  kana_wo: [example('本を読む', 'ほんをよむ', '读书')],
  kana_n: [example('本', 'ほん', '书（ん在词尾表示鼻音）')],

  kana_ga: [example('学生', 'がくせい', '学生')],
  kana_gi: [example('銀行', 'ぎんこう', '银行')],
  kana_gu: [example('具合', 'ぐあい', '状况')],
  kana_ge: [example('元気', 'げんき', '精神好')],
  kana_go: [example('ご飯', 'ごはん', '饭')],
  kana_za: [example('雑誌', 'ざっし', '杂志')],
  kana_ji: [example('時間', 'じかん', '时间')],
  kana_zu: [example('ずっと', 'ずっと', '一直')],
  kana_ze: [example('全部', 'ぜんぶ', '全部')],
  kana_zo: [example('象', 'ぞう', '大象')],
  kana_da: [example('大学', 'だいがく', '大学')],
  kana_dji: [example('縮む', 'ちぢむ', '缩小')],
  kana_dzu: [example('続く', 'つづく', '继续')],
  kana_de: [example('電車', 'でんしゃ', '电车')],
  kana_do: [example('動物', 'どうぶつ', '动物')],
  kana_ba: [example('バス', 'ばす', '公交车')],
  kana_bi: [example('病院', 'びょういん', '医院')],
  kana_bu: [example('豚', 'ぶた', '猪')],
  kana_be: [example('勉強', 'べんきょう', '学习')],
  kana_bo: [example('帽子', 'ぼうし', '帽子')],

  kana_pa: [example('パン', 'ぱん', '面包')],
  kana_pi: [example('ピアノ', 'ぴあの', '钢琴')],
  kana_pu: [example('プール', 'ぷーる', '游泳池')],
  kana_pe: [example('ペン', 'ぺん', '笔')],
  kana_po: [example('ポスト', 'ぽすと', '邮筒')],

  kana_kya: [example('客', 'きゃく', '客人')],
  kana_kyu: [example('きゅうり', 'きゅうり', '黄瓜')],
  kana_kyo: [example('今日', 'きょう', '今天')],
  kana_sha: [example('写真', 'しゃしん', '照片')],
  kana_shu: [example('趣味', 'しゅみ', '兴趣')],
  kana_sho: [example('醤油', 'しょうゆ', '酱油')],
  kana_cha: [example('茶', 'ちゃ', '茶')],
  kana_chu: [example('中国', 'ちゅうごく', '中国')],
  kana_cho: [example('ちょうちょ', 'ちょうちょ', '蝴蝶')],
  kana_nya: [example('にゃんこ', 'にゃんこ', '小猫')],
  kana_nyu: [example('入学', 'にゅうがく', '入学')],
  kana_nyo: [example('にょきにょき', 'にょきにょき', '冒芽、一个接一个长出来')],
  kana_hya: [example('百', 'ひゃく', '一百')],
  kana_hyu: [example('ひゅーひゅー', 'ひゅーひゅー', '呼呼的风声')],
  kana_hyo: [example('表', 'ひょう', '表格')],
  kana_mya: [example('脈', 'みゃく', '脉搏')],
  kana_myu: [example('ミュージック', 'みゅーじっく', '音乐')],
  kana_myo: [example('苗字', 'みょうじ', '姓氏')],
  kana_rya: [example('略語', 'りゃくご', '缩略语')],
  kana_ryu: [example('龍', 'りゅう', '龙')],
  kana_ryo: [example('料理', 'りょうり', '料理')],
  kana_gya: [example('逆', 'ぎゃく', '相反')],
  kana_gyu: [example('牛乳', 'ぎゅうにゅう', '牛奶')],
  kana_gyo: [example('餃子', 'ぎょうざ', '饺子')],
  kana_ja: [example('じゃがいも', 'じゃがいも', '土豆')],
  kana_ju: [example('授業', 'じゅぎょう', '课程')],
  kana_jo: [example('上手', 'じょうず', '擅长')],
  kana_bya: [example('白夜', 'びゃくや', '白夜')],
  kana_byu: [example('びゅーん', 'びゅーん', '嗖地飞过的声音')],
  kana_byo: [example('病気', 'びょうき', '生病')],
  kana_pya: [example('ぴゃー', 'ぴゃー', '尖叫声')],
  kana_pyu: [example('ピューマ', 'ぴゅーま', '美洲狮')],
  kana_pyo: [example('ぴょんぴょん', 'ぴょんぴょん', '蹦蹦跳')],
};

/** 清音的形状联想：它们是可替换的学习提示，不是字形的语言学事实。 */
const SEION_MEMORY_TIPS: Record<string, string> = {
  kana_a: '张大嘴说“啊”，把「あ」和 a 绑在一起。',
  kana_i: '「い」像两条并排的小鱼鳍，联想 i 的两根直线。',
  kana_u: '「う」像乌鸦低头的嘴，联想“乌”开头的 u。',
  kana_e: '「え」像一只鹅转身，联想“鹅”开头的 e。',
  kana_o: '「お」像人挥手说“哦”，先记住右侧的小钩。',
  kana_ka: '「か」像卡片折起一个角，联想“卡”开头的 ka。',
  kana_ki: '「き」的两横像钥匙齿，key 的 ki 提醒你读音。',
  kana_ku: '「く」像张开的嘴角，联想“哭”开头的 ku。',
  kana_ke: '「け」像一根竖杆穿过两道刻痕，联想“刻”的 ke。',
  kana_ko: '「こ」像两条平行横线，联想“口”字的两条边和 ko。',
  kana_sa: '「さ」像一把小剪刀张开，联想“撒”开头的 sa。',
  kana_shi: '「し」像一条向下滑的溪流，联想 shi 的长音起点。',
  kana_su: '「す」像丝线绕成一个结，联想“丝”开头的 su。',
  kana_se: '「せ」像十字架少了一笔，联想“世”开头的 se。',
  kana_so: '「そ」像一条弯弯的钩线，联想 so 的弯曲收笔。',
  kana_ta: '「た」像十字旁伸出一撇，联想“他”开头的 ta。',
  kana_chi: '「ち」像一把弯钩，联想“七”开头的 chi。',
  kana_tsu: '「つ」像一条小波浪，联想 tsu 的起伏气流。',
  kana_te: '「て」像摊开的手掌，联想“手”开头的 te。',
  kana_to: '「と」像一根带钩的长针，联想“图”开头的 to。',
  kana_na: '「な」像线绕过一个十字结，联想“那”开头的 na。',
  kana_ni: '「に」像两条并排的轨道，联想“你”开头的 ni。',
  kana_nu: '「ぬ」像一根线打结后拖出长尾，记住它有一个圈。',
  kana_ne: '「ね」像绳结带着向右的尾巴，联想“呢”开头的 ne。',
  kana_no: '「の」就是一笔绕成的圆，联想 NO 的 no。',
  kana_ha: '「は」像两片分开的叶子，联想“哈”开头的 ha。',
  kana_hi: '「ひ」像嘴角向上弯，联想 hi 的微笑。',
  kana_fu: '「ふ」像两朵轻轻吹散的云，联想“呼”开头的 fu。',
  kana_he: '「へ」像山峰或箭头，联想 he 的上扬形。',
  kana_ho: '「ほ」像一棵有横枝的小树，联想“火”开头的 ho。',
  kana_ma: '「ま」像线绕成一个结再向下收，联想“麻”开头的 ma。',
  kana_mi: '「み」像三道连续的水波，联想 mi 的三笔节奏。',
  kana_mu: '「む」像牛角和弯嘴组合，联想“木”开头的 mu。',
  kana_me: '「め」像两条线交叉打结，联想“眉”开头的 me。',
  kana_mo: '「も」像毛刷的两道横纹，联想“毛”开头的 mo。',
  kana_ya: '「や」像一把分叉的鱼叉，联想 ya 的开叉形。',
  kana_yu: '「ゆ」像鱼钩穿过圆圈，联想“鱼”开头的 yu。',
  kana_yo: '「よ」像一只挂钩，联想 yo 的短促收尾。',
  kana_ra: '「ら」像数字 7 弯下去，联想 ra 的弯钩。',
  kana_ri: '「り」像两把利落的小刀，联想“利”开头的 ri。',
  kana_ru: '「る」像留字的尾巴绕成圈，联想“留”开头的 ru。',
  kana_re: '「れ」像礼物丝带甩出一笔，联想“礼”开头的 re。',
  kana_ro: '「ろ」像一个打开的口，联想“路”开头的 ro。',
  kana_wa: '「わ」像弯弯的碗，联想“哇”开头的 wa。',
  kana_wo: '「を」先记作助词里的 o；把它和普通的「お」放在例句中一起比较。',
  kana_n: '「ん」像鼻音拖出的尾巴，联想 n 收在鼻腔里。',
};

/** 清音卡片中的听感抓手：解释“怎么听”，不把假名写成有独立词义的汉字。 */
const SOUND_DESCRIPTIONS: Record<string, string> = {
  kana_a: 'a：先听张口、舌位低的短元音；声音落在 a，不拖成长音。',
  kana_i: 'i：听起来明亮而靠前，嘴角展开；前面不要多出一个 y 起音。',
  kana_u: 'u：声音偏后、嘴唇轻收；比中文“乌”更放松，不要明显撅圆嘴。',
  kana_e: 'e：口形比 a 收窄，声音直接落在 e；不要滑成 ei。',
  kana_o: 'o：嘴唇略圆的短 o；声音收在 o，不继续滑向 u。',
  kana_ka: 'ka：先听清 k 的短暂起音，再落到张口的 a；k 和 a 合在一拍里。',
  kana_ki: 'ki：k 后接明亮的 i；先有后部的阻塞，再听到扁口 i。',
  kana_ku: 'ku：k 后接放松的 u；u 不要撅唇过度，两个部分合成一拍。',
  kana_ke: 'ke：k 后直接接 e；收尾是 e，不要听成带 i 的 ei。',
  kana_ko: 'ko：k 后接略圆的 o；结尾停在 o，不要多出 u。',
  kana_sa: 'sa：先有一丝 s 的气流摩擦，再打开到 a；起音不带声。',
  kana_shi: 'shi：这是 さ行的特殊擦音，听感接近 sh+i；不是普通的 si。',
  kana_su: 'su：s 的摩擦后接很轻的 u；u 短而不突出，不能拆成两拍。',
  kana_se: 'se：s 的摩擦后直接落到 e；不要把 e 拉成 ei。',
  kana_so: 'so：s 的摩擦后接略圆的 o；起音清楚，收尾不滑音。',
  kana_ta: 'ta：先听 t 的短暂闭塞，再打开到 a；起音干净而不拖长。',
  kana_chi: 'chi：开头先短暂阻塞再摩擦，听作 chi 的一拍；不是纯 ti。',
  kana_tsu: 'tsu：开头能听到 ts 的塞擦感，再接轻收的 u；不是 su。',
  kana_te: 'te：t 的短促起音后直接接 e；不要把 e 读成 ei。',
  kana_to: 'to：t 的短促起音后接略圆的 o；结尾收在 o。',
  kana_na: 'na：n 的鼻音起头后打开到 a；先听鼻腔的 n，再听清 a。',
  kana_ni: 'ni：n 的鼻音后接明亮的 i；i 不要带明显 y 起音。',
  kana_nu: 'nu：n 的鼻音后接放松的 u；u 很短，不能拖成 nuu。',
  kana_ne: 'ne：n 的鼻音后直接落到 e；不要把 e 滑成 ei。',
  kana_no: 'no：n 的鼻音后接略圆的 o；整拍结束在 o。',
  kana_ha: 'ha：气流从喉部擦过后接 a；是清音 h，不要加 g 的起音。',
  kana_hi: 'hi：舌面靠近硬腭形成较细的摩擦，再接 i；不是英语 hi 的完全照搬。',
  kana_fu: 'fu：双唇靠近形成 f-like 摩擦，再接轻收的 u；不是上齿咬下唇的英语 f。',
  kana_he: 'he：喉部摩擦后直接接 e；结尾是 e，不要滑成 ei。',
  kana_ho: 'ho：喉部摩擦后接略圆的 o；不要在 h 后加额外的 w。',
  kana_ma: 'ma：双唇闭合的 m 鼻音后打开到 a；先闭唇，再放开。',
  kana_mi: 'mi：双唇 m 后接明亮的 i；i 短而靠前。',
  kana_mu: 'mu：双唇 m 后接放松的 u；u 不要读成过分圆唇的中文乌。',
  kana_me: 'me：双唇 m 后直接接 e；不要把 e 拖成 ei。',
  kana_mo: 'mo：双唇 m 后接略圆的 o；鼻音起头和 o 收尾都要清楚。',
  kana_ya: 'ya：y 只是滑向 a 的一瞬，不单独占拍；不要拆成 yi-a。',
  kana_yu: 'yu：y 快速滑向放松的 u；嘴唇不要过分突出，整体一拍收住。',
  kana_yo: 'yo：y 快速滑向略圆的 o；不要把结尾拖成 yo-u。',
  kana_ra: 'ra：先轻弹一次舌尖再接 a；听感介于 r/l，不是中文卷舌 r。',
  kana_ri: 'ri：舌尖轻弹一次后接明亮的 i；不要连续颤舌，也不要用英语 r。',
  kana_ru: 'ru：舌尖轻弹一次后接放松的 u；u 短而不撅唇。',
  kana_re: 're：舌尖轻弹一次后直接接 e；不要把 e 滑成 ei。',
  kana_ro: 'ro：舌尖轻弹一次后接略圆的 o；尾音停在 o。',
  kana_wa: 'wa：w 只是一瞬的滑音，马上打开到 a；不要拆成 wu+a。',
};

const PRONUNCIATION_TIPS: Record<string, string> = {
  kana_a: '下颌自然下沉，嘴巴打开，声带平稳振动；一拍收住，不加中文声调。',
  kana_i: '嘴角向两侧展开，舌位靠前靠高；保持短 i，不要在前面加 y。',
  kana_u: '舌位偏后，嘴唇轻轻收圆但不要突出；日语 u 比中文“乌”更放松。',
  kana_e: '口形比 a 收一些，舌位保持稳定，直接发 e；不要把结尾滑成 i。',
  kana_o: '嘴唇略圆、下颌放松，发短 o；不要把一个拍拖成 ou。',
  kana_ka: '舌根在软腭处短暂闭塞，声带不振动，释放后马上接 a；不要把 k 发成 g。',
  kana_ki: '同样先做清音 k 的舌根闭塞，但随后嘴角展开接 i；k 不要浊化。',
  kana_ku: '舌根释放 k 后接放松的 u；嘴唇不要像中文乌那样明显前突。',
  kana_ke: '舌根释放 k 后直接接 e；保持一拍，不要在 e 后补 i。',
  kana_ko: '舌根释放 k 后接略圆的 o；声带不振动，尾音不要滑向 u。',
  kana_sa: '舌尖靠近上齿龈，让气流细细摩擦后接 a；声带不振动。',
  kana_shi: '舌面靠近硬腭形成擦音，直接接 i；不要先发完整 s 再拼 i。',
  kana_su: '舌尖靠近上齿龈摩擦，嘴唇不突出，u 只轻轻带过；不要拖成 suu。',
  kana_se: '舌尖摩擦后直接接 e；口形稳定，不要把 e 读成 ei。',
  kana_so: '舌尖摩擦后接略圆的 o；保持清音，尾音停在 o。',
  kana_ta: '舌尖轻触上齿龈后释放 t，接 a；不要把 t 拉成持续的 th。',
  kana_chi: '先有短暂闭塞，再让气流摩擦出去接 i；不要发成纯 ti。',
  kana_tsu: '舌尖先形成 ts 的塞擦，再快速接放松的 u；不要把它发成 su 或 tu。',
  kana_te: '舌尖闭塞释放 t 后直接接 e；e 要短，不要加 i。',
  kana_to: '舌尖闭塞释放 t 后接略圆的 o；声带不振动，保持一拍。',
  kana_na: '舌尖靠近上齿龈，气流先从鼻腔通过，再打开到 a；不要憋成 d。',
  kana_ni: '保持 n 的鼻音起头，舌位靠前接 i；不要把 n 丢掉或加 y。',
  kana_nu: 'n 后接放松的 u；鼻音和元音连成一拍，u 不要过分圆唇。',
  kana_ne: 'n 后直接接 e；舌尖动作轻，e 不要滑向 ei。',
  kana_no: 'n 后接略圆的 o；先听鼻音，再听 o 的收尾。',
  kana_ha: '让气流从喉部通过形成 h，再接 a；声带不要先振动成 g。',
  kana_hi: '舌面向硬腭靠近，形成比 ha 更细的摩擦，再接 i；不要照搬英语 h。',
  kana_fu: '上下唇接近但不闭死，让气流从唇缝擦出；不要让上齿咬下唇。',
  kana_he: '喉部送出清气后直接接 e；e 保持短而平。',
  kana_ho: '喉部送出清气后接 o；嘴唇略圆但不添加 w 起音。',
  kana_ma: '双唇先完全闭合，气流从鼻腔通过，再打开接 a；声带保持振动。',
  kana_mi: '双唇闭合形成 m 后打开接 i；嘴角展开，i 不拖长。',
  kana_mu: '双唇闭合形成 m 后接放松的 u；不要把 u 发得过分圆。',
  kana_me: '双唇闭合形成 m 后直接接 e；e 不要滑成 ei。',
  kana_mo: '双唇闭合形成 m 后接略圆的 o；不要拖成 moo。',
  kana_ya: '舌面先做 y 的滑音，马上打开到 a；y 不单独占一拍。',
  kana_yu: '舌面做 y 的滑音后接放松 u；嘴唇轻收，不要明显前突。',
  kana_yo: '舌面做 y 的滑音后接 o；o 短而略圆，不要继续滑向 u。',
  kana_ra: '舌尖在上齿龈附近轻弹一次后接 a；不要卷舌或连续颤动。',
  kana_ri: '舌尖只轻弹一次，随后接明亮的 i；不要用英语 r 的卷舌位置。',
  kana_ru: '舌尖轻弹一次后接放松 u；u 不要过分圆唇，也不要拖长。',
  kana_re: '舌尖轻弹一次后接 e；弹音短，e 不要滑成 ei。',
  kana_ro: '舌尖轻弹一次后接略圆 o；不要把 r 读成中文卷舌音。',
  kana_wa: '双唇轻收后快速滑向 a；w 不单独成拍，不要读成 wu-a。',
  kana_wo: '现代标准日语中作助词时读 o；嘴唇直接发 o，不要为了拼写 wo 加 w。',
  kana_n: '让声音收在鼻腔，鼻音占一拍；不要在 n 后补 a/i/u/e/o。',
};

const CONFUSION_NOTES: Record<string, string> = {
  kana_a: '与「お」对照：あ有中间的交叉/分叉结构，お的右侧有小钩；读音按 a/o 听，不要只看外轮廓。',
  kana_i: '与「り」对照：い是两条向下的短笔，り的右笔会向内弯；读音是 i/ri。',
  kana_u: '与「つ」对照：う上方有小短笔，つ主体是一条波形；读音是 u/tsu。',
  kana_e: '与「ん」对照：え有横折和下方的大弯，ん没有横折、主要是一笔回弯；读音是 e/n。',
  kana_o: '与「を」对照：お是普通音节 o，を主要写在宾语助词位置；听起来相近时看句法和字形。',
  kana_ka: '与「が」对照：两者主体相同，が右上多两个浊点；差异在标记和清/浊的起音。',
  kana_ki: '与「さ」对照：き有多条横线和竖向收笔，さ下方是回钩；读音是 ki/sa。',
  kana_ku: '与「へ」对照：く是单个尖折线，へ像山峰且转折更开；读音是 ku/he。',
  kana_ke: '与「は」对照：け的右侧竖画穿过横线，は是左右分开的两部分；读音是 ke/ha。',
  kana_ko: '与「に」对照：こ只有两条平行横线，に还多出一条竖向弯笔；读音是 ko/ni。',
  kana_sa: '与「き」对照：さ的下方是圆弯收笔，き有竖向收笔和更多横线；读音是 sa/ki。',
  kana_shi: '与「つ」对照：し是一条向下滑的弯线，つ是上方连续的波形；读音是 shi/tsu。',
  kana_su: '与「つ」对照：す有横画、圆弯和长尾，つ只有波形主体；读音是 su/tsu。',
  kana_se: '与「き」对照：せ有一条竖钩穿过主体，き的横线和下竖更明显；读音是 se/ki。',
  kana_so: '与「ん」对照：そ通常能看到上方短笔后接长尾，ん是连续回弯的一笔；读音是 so/n。',
  kana_ta: '与「な」对照：た有明显十字和右下弯笔，な像绕结后向下收；读音是 ta/na。',
  kana_chi: '与「ら」对照：ち上方有横画、下方是钩弯，ら从小短笔落向右下；读音是 chi/ra。',
  kana_tsu: '与「す」和「し」对照：つ的上方是波形且有 ts 起音，す有交叉和长尾、し是单条向下弯线；读音是 tsu/su/shi。',
  kana_te: '与「と」对照：て有横画后向下弯，と有分开的短笔和长弯；读音是 te/to。',
  kana_to: '与「て」对照：と的上方短笔与下方长弯分开，て先横后弯；读音是 to/te。',
  kana_na: '与「ぬ」对照：な下方没有完整圆圈，ぬ有圆圈并拖出长尾；读音是 na/nu。',
  kana_ni: '与「こ」对照：に的竖向弯笔会穿过/连接两条横线，こ只有两条横线；读音是 ni/ko。',
  kana_nu: '与「め」对照：ぬ有圆圈和向外拖出的长尾，め是交叉收笔；读音是 nu/me。',
  kana_ne: '与「れ」对照：ね有明显圆圈和向右回钩，れ没有圆圈；读音是 ne/re。',
  kana_no: '与「ぬ」对照：の只有一笔圆弯，ぬ会形成圆圈并拖出尾巴；读音是 no/nu。',
  kana_ha: '与「ほ」对照：ほ比は多一条横线/竖向结构；先数中间横画，再听 ha/ho。',
  kana_hi: '与「ん」对照：ひ的弯口更开、笔势分成两段，ん是一条回弯鼻音线；读音是 hi/n。',
  kana_fu: '与「ら」对照：ふ上方有两小笔和下方弯线，ら没有这组双小笔；读音是 fu/ra。',
  kana_he: '与「く」对照：へ是两笔形成的山峰，く是一笔尖折；读音是 he/ku。',
  kana_ho: '与「は」对照：ほ多出中间的横线和竖向结构，は的两部分更分开；读音是 ho/ha。',
  kana_ma: '与「ほ」对照：ま有圆弧结和下收尾，ほ有十字状横竖结构；读音是 ma/ho。',
  kana_mi: '与「ぬ」对照：み是连续弯笔但不形成完整圆圈，ぬ有圆圈和长尾；读音是 mi/nu。',
  kana_mu: '与「す」对照：む上方横笔后有明显右侧长尾，す有交叉和圆弯；读音是 mu/su。',
  kana_me: '与「ぬ」对照：め是交叉后收笔，ぬ会绕出圆圈并拖长尾；读音是 me/nu。',
  kana_mo: '与「ほ」对照：も主要是两道横线和下方弯钩，ほ有横竖交叉；读音是 mo/ho。',
  kana_ya: '与「か」对照：や有分叉上笔和长斜线，か有十字与右下弯；读音是 ya/ka。',
  kana_yu: '与「ぬ」对照：ゆ有竖线穿过较开的弯圈，没有ぬ那样的长尾；读音是 yu/nu。',
  kana_yo: '与「ま」对照：よ是横线加右侧钩，ま有圆弧结和下收尾；读音是 yo/ma。',
  kana_ra: '与「う」对照：ら的下方弯笔向右下展开，う是小短笔加碗形弯线；读音是 ra/u。',
  kana_ri: '与「い」对照：り的右笔向内弯并更长，い是两条简单下行笔；读音是 ri/i。',
  kana_ru: '与「ろ」对照：る会闭出小圈并拖长尾，ろ只是打开的弯线；读音是 ru/ro。',
  kana_re: '与「ね」对照：れ没有圆圈，ね有圆圈和向右回钩；读音是 re/ne。',
  kana_ro: '与「る」对照：ろ没有闭合小圈和长尾，る会绕出圈；读音是 ro/ru。',
  kana_wa: '与「ね」对照：わ没有闭合圆圈，ね有圆圈并向右回钩；读音是 wa/ne。',
  kana_wo: '与「お」对照：两者现代读音都常为 o，但を主要是宾语助词；不能只靠声音区分，要看句子功能。',
  kana_n: '与「ね」「ぬ」对照：ん是鼻音收尾，不会再打开 e/u 元音；ね、ぬ都会继续发出元音。',
};

const VOICING_BASE_BY_HIRAGANA: Record<string, string> = {
  が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ',
  ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ',
  だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と',
  ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ',
  ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ',
};

const BASE_KANA_SEEDS: KanaItem[] = [
  // ================= あ行 =================
  { id: 'kana_a', type: 'SEION', hiragana: 'あ', katakana: 'ア', romaji: 'a', row: 'あ行', col: 'あ段', mnemonic: '源自汉字草书「安」', audioText: 'あ', sortOrder: 1 },
  { id: 'kana_i', type: 'SEION', hiragana: 'い', katakana: 'イ', romaji: 'i', row: 'あ行', col: 'い段', mnemonic: '源自汉字草书「以」', audioText: 'い', sortOrder: 2 },
  { id: 'kana_u', type: 'SEION', hiragana: 'う', katakana: 'ウ', romaji: 'u', row: 'あ行', col: 'う段', mnemonic: '源自汉字草书「宇」', audioText: 'う', sortOrder: 3 },
  { id: 'kana_e', type: 'SEION', hiragana: 'え', katakana: 'エ', romaji: 'e', row: 'あ行', col: 'え段', mnemonic: '源自汉字草书「衣」', audioText: 'え', sortOrder: 4 },
  { id: 'kana_o', type: 'SEION', hiragana: 'お', katakana: 'オ', romaji: 'o', row: 'あ行', col: 'お段', mnemonic: '源自汉字草书「於」', audioText: 'お', sortOrder: 5 },

  // ================= か行 =================
  { id: 'kana_ka', type: 'SEION', hiragana: 'か', katakana: 'カ', romaji: 'ka', row: 'か行', col: 'あ段', mnemonic: '源自汉字草书「加」', audioText: 'か', sortOrder: 6 },
  { id: 'kana_ki', type: 'SEION', hiragana: 'き', katakana: 'キ', romaji: 'ki', row: 'か行', col: 'い段', mnemonic: '源自汉字草书「幾」', audioText: 'き', sortOrder: 7 },
  { id: 'kana_ku', type: 'SEION', hiragana: 'く', katakana: 'ク', romaji: 'ku', row: 'か行', col: 'う段', mnemonic: '源自汉字草书「久」', audioText: 'く', sortOrder: 8 },
  { id: 'kana_ke', type: 'SEION', hiragana: 'け', katakana: 'ケ', romaji: 'ke', row: 'か行', col: 'え段', mnemonic: '源自汉字草书「計」', audioText: 'け', sortOrder: 9 },
  { id: 'kana_ko', type: 'SEION', hiragana: 'こ', katakana: 'コ', romaji: 'ko', row: 'か行', col: 'お段', mnemonic: '源自汉字草书「己」', audioText: 'こ', sortOrder: 10 },

  // ================= さ行 =================
  { id: 'kana_sa', type: 'SEION', hiragana: 'さ', katakana: 'サ', romaji: 'sa', row: 'さ行', col: 'あ段', mnemonic: '源自汉字草书「左」', audioText: 'さ', sortOrder: 11 },
  { id: 'kana_shi', type: 'SEION', hiragana: 'し', katakana: 'シ', romaji: 'shi', row: 'さ行', col: 'い段', mnemonic: '源自汉字草书「之」', audioText: 'し', sortOrder: 12 },
  { id: 'kana_su', type: 'SEION', hiragana: 'す', katakana: 'ス', romaji: 'su', row: 'さ行', col: 'う段', mnemonic: '源自汉字草书「寸」', audioText: 'す', sortOrder: 13 },
  { id: 'kana_se', type: 'SEION', hiragana: 'せ', katakana: 'セ', romaji: 'se', row: 'さ行', col: 'え段', mnemonic: '源自汉字草书「世」', audioText: 'せ', sortOrder: 14 },
  { id: 'kana_so', type: 'SEION', hiragana: 'そ', katakana: 'ソ', romaji: 'so', row: 'さ行', col: 'お段', mnemonic: '源自汉字草书「曾」', audioText: 'そ', sortOrder: 15 },

  // ================= た行 =================
  { id: 'kana_ta', type: 'SEION', hiragana: 'た', katakana: 'タ', romaji: 'ta', row: 'た行', col: 'あ段', mnemonic: '源自汉字草书「太」', audioText: 'た', sortOrder: 16 },
  { id: 'kana_chi', type: 'SEION', hiragana: 'ち', katakana: 'チ', romaji: 'chi', row: 'た行', col: 'い段', mnemonic: '源自汉字草书「知」', audioText: 'ち', sortOrder: 17 },
  { id: 'kana_tsu', type: 'SEION', hiragana: 'つ', katakana: 'ツ', romaji: 'tsu', row: 'た行', col: 'う段', mnemonic: '源自汉字草书「川」', audioText: 'つ', sortOrder: 18 },
  { id: 'kana_te', type: 'SEION', hiragana: 'て', katakana: 'テ', romaji: 'te', row: 'た行', col: 'え段', mnemonic: '源自汉字草书「天」', audioText: 'て', sortOrder: 19 },
  { id: 'kana_to', type: 'SEION', hiragana: 'と', katakana: 'ト', romaji: 'to', row: 'た行', col: 'お段', mnemonic: '源自汉字草书「止」', audioText: 'と', sortOrder: 20 },

  // ================= な行 =================
  { id: 'kana_na', type: 'SEION', hiragana: 'な', katakana: 'ナ', romaji: 'na', row: 'な行', col: 'あ段', mnemonic: '源自汉字草书「奈」', audioText: 'な', sortOrder: 21 },
  { id: 'kana_ni', type: 'SEION', hiragana: 'に', katakana: 'ニ', romaji: 'ni', row: 'な行', col: 'い段', mnemonic: '源自汉字草书「仁」', audioText: 'に', sortOrder: 22 },
  { id: 'kana_nu', type: 'SEION', hiragana: 'ぬ', katakana: 'ヌ', romaji: 'nu', row: 'な行', col: 'う段', mnemonic: '源自汉字草书「奴」', audioText: 'ぬ', sortOrder: 23 },
  { id: 'kana_ne', type: 'SEION', hiragana: 'ね', katakana: 'ネ', romaji: 'ne', row: 'な行', col: 'え段', mnemonic: '源自汉字草书「祢」', audioText: 'ね', sortOrder: 24 },
  { id: 'kana_no', type: 'SEION', hiragana: 'の', katakana: 'ノ', romaji: 'no', row: 'な行', col: 'お段', mnemonic: '源自汉字草书「乃」', audioText: 'の', sortOrder: 25 },

  // ================= は行 =================
  { id: 'kana_ha', type: 'SEION', hiragana: 'は', katakana: 'ハ', romaji: 'ha', row: 'は行', col: 'あ段', mnemonic: '源自汉字草书「波」', audioText: 'は', sortOrder: 26 },
  { id: 'kana_hi', type: 'SEION', hiragana: 'ひ', katakana: 'ヒ', romaji: 'hi', row: 'は行', col: 'い段', mnemonic: '源自汉字草书「比」', audioText: 'ひ', sortOrder: 27 },
  { id: 'kana_fu', type: 'SEION', hiragana: 'ふ', katakana: 'フ', romaji: 'fu', row: 'は行', col: 'う段', mnemonic: '源自汉字草书「不」', audioText: 'ふ', sortOrder: 28 },
  { id: 'kana_he', type: 'SEION', hiragana: 'へ', katakana: 'ヘ', romaji: 'he', row: 'は行', col: 'え段', mnemonic: '源自汉字草书「部」', audioText: 'へ', sortOrder: 29 },
  { id: 'kana_ho', type: 'SEION', hiragana: 'ほ', katakana: 'ホ', romaji: 'ho', row: 'は行', col: 'お段', mnemonic: '源自汉字草书「保」', audioText: 'ほ', sortOrder: 30 },

  // ================= ま行 =================
  { id: 'kana_ma', type: 'SEION', hiragana: 'ま', katakana: 'マ', romaji: 'ma', row: 'ま行', col: 'あ段', mnemonic: '源自汉字草书「末」', audioText: 'ま', sortOrder: 31 },
  { id: 'kana_mi', type: 'SEION', hiragana: 'み', katakana: 'ミ', romaji: 'mi', row: 'ま行', col: 'い段', mnemonic: '源自汉字草书「美」', audioText: 'み', sortOrder: 32 },
  { id: 'kana_mu', type: 'SEION', hiragana: 'む', katakana: 'ム', romaji: 'mu', row: 'ま行', col: 'う段', mnemonic: '源自汉字草书「武」', audioText: 'む', sortOrder: 33 },
  { id: 'kana_me', type: 'SEION', hiragana: 'め', katakana: 'メ', romaji: 'me', row: 'ま行', col: 'え段', mnemonic: '源自汉字草书「女」', audioText: 'め', sortOrder: 34 },
  { id: 'kana_mo', type: 'SEION', hiragana: 'も', katakana: 'モ', romaji: 'mo', row: 'ま行', col: 'お段', mnemonic: '源自汉字草书「毛」', audioText: 'も', sortOrder: 35 },

  // ================= や行 =================
  { id: 'kana_ya', type: 'SEION', hiragana: 'や', katakana: 'ヤ', romaji: 'ya', row: 'や行', col: 'あ段', mnemonic: '源自汉字草书「也」', audioText: 'や', sortOrder: 36 },
  { id: 'kana_yu', type: 'SEION', hiragana: 'ゆ', katakana: 'ユ', romaji: 'yu', row: 'や行', col: 'う段', mnemonic: '源自汉字草书「由」', audioText: 'ゆ', sortOrder: 37 },
  { id: 'kana_yo', type: 'SEION', hiragana: 'よ', katakana: 'ヨ', romaji: 'yo', row: 'や行', col: 'お段', mnemonic: '源自汉字草书「与」', audioText: 'よ', sortOrder: 38 },

  // ================= ら行 =================
  { id: 'kana_ra', type: 'SEION', hiragana: 'ら', katakana: 'ラ', romaji: 'ra', row: 'ら行', col: 'あ段', mnemonic: '源自汉字草书「良」', audioText: 'ら', sortOrder: 39 },
  { id: 'kana_ri', type: 'SEION', hiragana: 'り', katakana: 'リ', romaji: 'ri', row: 'ら行', col: 'い段', mnemonic: '源自汉字草书「利」', audioText: 'り', sortOrder: 40 },
  { id: 'kana_ru', type: 'SEION', hiragana: 'る', katakana: 'ル', romaji: 'ru', row: 'ら行', col: 'う段', mnemonic: '源自汉字草书「留」', audioText: 'る', sortOrder: 41 },
  { id: 'kana_re', type: 'SEION', hiragana: 'れ', katakana: 'レ', romaji: 're', row: 'ら行', col: 'え段', mnemonic: '源自汉字草书「礼」', audioText: 'れ', sortOrder: 42 },
  { id: 'kana_ro', type: 'SEION', hiragana: 'ろ', katakana: 'ロ', romaji: 'ro', row: 'ら行', col: 'お段', mnemonic: '源自汉字草书「吕」', audioText: 'ろ', sortOrder: 43 },

  // ================= わ行与特殊 =================
  { id: 'kana_wa', type: 'SEION', hiragana: 'わ', katakana: 'ワ', romaji: 'wa', row: 'わ行', col: 'あ段', mnemonic: '源自汉字草书「和」', audioText: 'わ', sortOrder: 44 },
  { id: 'kana_wo', type: 'SEION', hiragana: 'を', katakana: 'ヲ', romaji: 'o', row: 'わ行', col: 'お段', mnemonic: '源自汉字草书「乎」，常作宾语助词', audioText: 'を', sortOrder: 45 },
  { id: 'kana_n', type: 'SPECIAL', hiragana: 'ん', katakana: 'ン', romaji: 'n', row: '特殊', col: '特殊', mnemonic: '源自汉字草书「无」，鼻音拨音', audioText: 'ん', sortOrder: 46 },

  // ================= 浊音 (20) =================
  { id: 'kana_ga', type: 'DAKUON', hiragana: 'が', katakana: 'ガ', romaji: 'ga', row: 'が行', col: 'あ段', audioText: 'が', sortOrder: 47 },
  { id: 'kana_gi', type: 'DAKUON', hiragana: 'ぎ', katakana: 'ギ', romaji: 'gi', row: 'が行', col: 'い段', audioText: 'ぎ', sortOrder: 48 },
  { id: 'kana_gu', type: 'DAKUON', hiragana: 'ぐ', katakana: 'グ', romaji: 'gu', row: 'が行', col: 'う段', audioText: 'ぐ', sortOrder: 49 },
  { id: 'kana_ge', type: 'DAKUON', hiragana: 'げ', katakana: 'ゲ', romaji: 'ge', row: 'が行', col: 'え段', audioText: 'げ', sortOrder: 50 },
  { id: 'kana_go', type: 'DAKUON', hiragana: 'ご', katakana: 'ゴ', romaji: 'go', row: 'が行', col: 'お段', audioText: 'ご', sortOrder: 51 },

  { id: 'kana_za', type: 'DAKUON', hiragana: 'ざ', katakana: 'ザ', romaji: 'za', row: 'ざ行', col: 'あ段', audioText: 'ざ', sortOrder: 52 },
  { id: 'kana_ji', type: 'DAKUON', hiragana: 'じ', katakana: 'ジ', romaji: 'ji', row: 'ざ行', col: 'い段', audioText: 'じ', sortOrder: 53 },
  { id: 'kana_zu', type: 'DAKUON', hiragana: 'ず', katakana: 'ズ', romaji: 'zu', row: 'ざ行', col: 'う段', audioText: 'ず', sortOrder: 54 },
  { id: 'kana_ze', type: 'DAKUON', hiragana: 'ぜ', katakana: 'ゼ', romaji: 'ze', row: 'ざ行', col: 'え段', audioText: 'ぜ', sortOrder: 55 },
  { id: 'kana_zo', type: 'DAKUON', hiragana: 'ぞ', katakana: 'ゾ', romaji: 'zo', row: 'ざ行', col: 'お段', audioText: 'ぞ', sortOrder: 56 },

  { id: 'kana_da', type: 'DAKUON', hiragana: 'だ', katakana: 'ダ', romaji: 'da', row: 'だ行', col: 'あ段', audioText: 'だ', sortOrder: 57 },
  { id: 'kana_dji', type: 'DAKUON', hiragana: 'ぢ', katakana: 'ヂ', romaji: 'ji', row: 'だ行', col: 'い段', audioText: 'ぢ', sortOrder: 58 },
  { id: 'kana_dzu', type: 'DAKUON', hiragana: 'づ', katakana: 'ヅ', romaji: 'zu', row: 'だ行', col: 'う段', audioText: 'づ', sortOrder: 59 },
  { id: 'kana_de', type: 'DAKUON', hiragana: 'で', katakana: 'デ', romaji: 'de', row: 'だ行', col: 'え段', audioText: 'で', sortOrder: 60 },
  { id: 'kana_do', type: 'DAKUON', hiragana: 'ど', katakana: 'ド', romaji: 'do', row: 'だ行', col: 'お段', audioText: 'ど', sortOrder: 61 },

  { id: 'kana_ba', type: 'DAKUON', hiragana: 'ば', katakana: 'バ', romaji: 'ba', row: 'ば行', col: 'あ段', audioText: 'ば', sortOrder: 62 },
  { id: 'kana_bi', type: 'DAKUON', hiragana: 'び', katakana: 'ビ', romaji: 'bi', row: 'ば行', col: 'い段', audioText: 'び', sortOrder: 63 },
  { id: 'kana_bu', type: 'DAKUON', hiragana: 'ぶ', katakana: 'ブ', romaji: 'bu', row: 'ば行', col: 'う段', audioText: 'ぶ', sortOrder: 64 },
  { id: 'kana_be', type: 'DAKUON', hiragana: 'べ', katakana: 'ベ', romaji: 'be', row: 'ば行', col: 'え段', audioText: 'べ', sortOrder: 65 },
  { id: 'kana_bo', type: 'DAKUON', hiragana: 'ぼ', katakana: 'ボ', romaji: 'bo', row: 'ば行', col: 'お段', audioText: 'ぼ', sortOrder: 66 },

  // ================= 半浊音 (5) =================
  { id: 'kana_pa', type: 'HANDAKUON', hiragana: 'ぱ', katakana: 'パ', romaji: 'pa', row: 'ぱ行', col: 'あ段', audioText: 'ぱ', sortOrder: 67 },
  { id: 'kana_pi', type: 'HANDAKUON', hiragana: 'ぴ', katakana: 'ピ', romaji: 'pi', row: 'ぱ行', col: 'い段', audioText: 'ぴ', sortOrder: 68 },
  { id: 'kana_pu', type: 'HANDAKUON', hiragana: 'ぷ', katakana: 'プ', romaji: 'pu', row: 'ぱ行', col: 'う段', audioText: 'ぷ', sortOrder: 69 },
  { id: 'kana_pe', type: 'HANDAKUON', hiragana: 'ぺ', katakana: 'ペ', romaji: 'pe', row: 'ぱ行', col: 'え段', audioText: 'ぺ', sortOrder: 70 },
  { id: 'kana_po', type: 'HANDAKUON', hiragana: 'ぽ', katakana: 'ポ', romaji: 'po', row: 'ぱ行', col: 'お段', audioText: 'ぽ', sortOrder: 71 },

  // ================= 常用拗音 (36) =================
  { id: 'kana_kya', type: 'YOON', hiragana: 'きゃ', katakana: 'キャ', romaji: 'kya', row: 'き拗音', col: 'あ段', audioText: 'きゃ', sortOrder: 72 },
  { id: 'kana_kyu', type: 'YOON', hiragana: 'きゅ', katakana: 'キュ', romaji: 'kyu', row: 'き拗音', col: 'う段', audioText: 'きゅ', sortOrder: 73 },
  { id: 'kana_kyo', type: 'YOON', hiragana: 'きょ', katakana: 'キョ', romaji: 'kyo', row: 'き拗音', col: 'お段', audioText: 'きょ', sortOrder: 74 },

  { id: 'kana_sha', type: 'YOON', hiragana: 'しゃ', katakana: 'シャ', romaji: 'sha', row: 'し拗音', col: 'あ段', audioText: 'しゃ', sortOrder: 75 },
  { id: 'kana_shu', type: 'YOON', hiragana: 'しゅ', katakana: 'シュ', romaji: 'shu', row: 'し拗音', col: 'う段', audioText: 'しゅ', sortOrder: 76 },
  { id: 'kana_sho', type: 'YOON', hiragana: 'しょ', katakana: 'ショ', romaji: 'sho', row: 'し拗音', col: 'お段', audioText: 'しょ', sortOrder: 77 },

  { id: 'kana_cha', type: 'YOON', hiragana: 'ちゃ', katakana: 'チャ', romaji: 'cha', row: 'ち拗音', col: 'あ段', audioText: 'ちゃ', sortOrder: 78 },
  { id: 'kana_chu', type: 'YOON', hiragana: 'ちゅ', katakana: 'チュ', romaji: 'chu', row: 'ち拗音', col: 'う段', audioText: 'ちゅ', sortOrder: 79 },
  { id: 'kana_cho', type: 'YOON', hiragana: 'ちょ', katakana: 'チョ', romaji: 'cho', row: 'ち拗音', col: 'お段', audioText: 'ちょ', sortOrder: 80 },

  { id: 'kana_nya', type: 'YOON', hiragana: 'にゃ', katakana: 'ニャ', romaji: 'nya', row: 'に拗音', col: 'あ段', audioText: 'にゃ', sortOrder: 81 },
  { id: 'kana_nyu', type: 'YOON', hiragana: 'にゅ', katakana: 'ニュ', romaji: 'nyu', row: 'に拗音', col: 'う段', audioText: 'にゅ', sortOrder: 82 },
  { id: 'kana_nyo', type: 'YOON', hiragana: 'にょ', katakana: 'ニョ', romaji: 'nyo', row: 'に拗音', col: 'お段', audioText: 'にょ', sortOrder: 83 },

  { id: 'kana_hya', type: 'YOON', hiragana: 'ひゃ', katakana: 'ヒャ', romaji: 'hya', row: 'ひ拗音', col: 'あ段', audioText: 'ひゃ', sortOrder: 84 },
  { id: 'kana_hyu', type: 'YOON', hiragana: 'ひゅ', katakana: 'ヒュ', romaji: 'hyu', row: 'ひ拗音', col: 'う段', audioText: 'ひゅ', sortOrder: 85 },
  { id: 'kana_hyo', type: 'YOON', hiragana: 'ひょ', katakana: 'ヒョ', romaji: 'hyo', row: 'ひ拗音', col: 'お段', audioText: 'ひょ', sortOrder: 86 },

  { id: 'kana_mya', type: 'YOON', hiragana: 'みゃ', katakana: 'ミャ', romaji: 'mya', row: 'み拗音', col: 'あ段', audioText: 'みゃ', sortOrder: 87 },
  { id: 'kana_myu', type: 'YOON', hiragana: 'みゅ', katakana: 'ミュ', romaji: 'myu', row: 'み拗音', col: 'う段', audioText: 'みゅ', sortOrder: 88 },
  { id: 'kana_myo', type: 'YOON', hiragana: 'みょ', katakana: 'ミョ', romaji: 'myo', row: 'み拗音', col: 'お段', audioText: 'みょ', sortOrder: 89 },

  { id: 'kana_rya', type: 'YOON', hiragana: 'りゃ', katakana: 'リャ', romaji: 'rya', row: 'り拗音', col: 'あ段', audioText: 'りゃ', sortOrder: 90 },
  { id: 'kana_ryu', type: 'YOON', hiragana: 'りゅ', katakana: 'リュ', romaji: 'ryu', row: 'り拗音', col: 'う段', audioText: 'りゅ', sortOrder: 91 },
  { id: 'kana_ryo', type: 'YOON', hiragana: 'りょ', katakana: 'リョ', romaji: 'ryo', row: 'り拗音', col: 'お段', audioText: 'りょ', sortOrder: 92 },

  { id: 'kana_gya', type: 'YOON', hiragana: 'ぎゃ', katakana: 'ギャ', romaji: 'gya', row: 'ぎ拗音', col: 'あ段', audioText: 'ぎゃ', sortOrder: 93 },
  { id: 'kana_gyu', type: 'YOON', hiragana: 'ぎゅ', katakana: 'ギュ', romaji: 'gyu', row: 'ぎ拗音', col: 'う段', audioText: 'ぎゅ', sortOrder: 94 },
  { id: 'kana_gyo', type: 'YOON', hiragana: 'ぎょ', katakana: 'ギョ', romaji: 'gyo', row: 'ぎ拗音', col: 'お段', audioText: 'ぎょ', sortOrder: 95 },

  { id: 'kana_ja', type: 'YOON', hiragana: 'じゃ', katakana: 'ジャ', romaji: 'ja', row: 'じ拗音', col: 'あ段', audioText: 'じゃ', sortOrder: 96 },
  { id: 'kana_ju', type: 'YOON', hiragana: 'じゅ', katakana: 'ジュ', romaji: 'ju', row: 'じ拗音', col: 'う段', audioText: 'じゅ', sortOrder: 97 },
  { id: 'kana_jo', type: 'YOON', hiragana: 'じょ', katakana: 'ジョ', romaji: 'jo', row: 'じ拗音', col: 'お段', audioText: 'じょ', sortOrder: 98 },

  { id: 'kana_bya', type: 'YOON', hiragana: 'びゃ', katakana: 'ビャ', romaji: 'bya', row: 'び拗音', col: 'あ段', audioText: 'びゃ', sortOrder: 99 },
  { id: 'kana_byu', type: 'YOON', hiragana: 'びゅ', katakana: 'ビュ', romaji: 'byu', row: 'び拗音', col: 'う段', audioText: 'びゅ', sortOrder: 100 },
  { id: 'kana_byo', type: 'YOON', hiragana: 'びょ', katakana: 'ビョ', romaji: 'byo', row: 'び拗音', col: 'お段', audioText: 'びょ', sortOrder: 101 },

  { id: 'kana_pya', type: 'YOON', hiragana: 'ぴゃ', katakana: 'ピャ', romaji: 'pya', row: 'ぴ拗音', col: 'あ段', audioText: 'ぴゃ', sortOrder: 102 },
  { id: 'kana_pyu', type: 'YOON', hiragana: 'ぴゅ', katakana: 'ピュ', romaji: 'pyu', row: 'ぴ拗音', col: 'う段', audioText: 'ぴゅ', sortOrder: 103 },
  { id: 'kana_pyo', type: 'YOON', hiragana: 'ぴょ', katakana: 'ピョ', romaji: 'pyo', row: 'ぴ拗音', col: 'お段', audioText: 'ぴょ', sortOrder: 104 },
];

const VOWEL_SOUND_HANDLES: Record<string, string> = {
  'あ段': '张口、舌位低的 a',
  'い段': '嘴角展开的明亮 i',
  'う段': '嘴唇轻收的放松 u',
  'え段': '口形收窄的直接 e',
  'お段': '嘴唇略圆的短 o',
};

const VOWEL_ARTICULATION_TIPS: Record<string, string> = {
  'あ段': '下颌自然下沉，嘴巴打开',
  'い段': '嘴角向两侧展开，舌位靠前靠高',
  'う段': '舌位偏后，嘴唇轻轻收圆但不前突',
  'え段': '口形比 a 收一些，舌位保持稳定',
  'お段': '嘴唇略圆、下颌放松',
};

const DAKUON_SOUND_HANDLES: Record<string, string> = {
  'が行': '舌根位置的 k 起音变成带声的 g',
  'ざ行': '擦音起头带上声带振动，じ是其中的特殊 j 音',
  'だ行': '舌尖的 t 系起音带上声带振动，ぢ/づ另有同音提示',
  'ば行': '双唇闭合的 b 起音带上声带振动',
};

const DAKUON_ARTICULATION_TIPS: Record<string, string> = {
  'が行': '舌根在软腭处短暂闭塞，释放时让声带振动',
  'ざ行': '舌尖/舌面靠近上齿龈形成摩擦，同时让声带振动',
  'だ行': '舌尖轻触上齿龈后释放，起音时让声带振动',
  'ば行': '双唇先闭合，带着声带振动释放 b',
};

const HANDAKUON_VOICED_BY_HIRAGANA: Record<string, string> = {
  ぱ: 'ば',
  ぴ: 'び',
  ぷ: 'ぶ',
  ぺ: 'べ',
  ぽ: 'ぼ',
};

const YOON_GLIDES: Record<string, { kana: string; romaji: string }> = {
  ゃ: { kana: 'や', romaji: 'ya' },
  ゅ: { kana: 'ゆ', romaji: 'yu' },
  ょ: { kana: 'よ', romaji: 'yo' },
};

const YOON_BASE_ARTICULATION: Record<string, string> = {
  き: '先做 k 的舌根闭塞，再把舌面抬向硬腭',
  し: '先做 sh 的舌面擦音，再保持舌面靠近硬腭',
  ち: '先做 ch 的短暂闭塞和摩擦，再抬舌面',
  に: '先做 n 的鼻音，随后把舌面抬高',
  ひ: '先做 h 的摩擦，再把舌面抬向硬腭',
  み: '先做双唇 m，再把舌面抬高',
  り: '先轻弹一次舌尖，再把舌面抬高',
  ぎ: '先做带声 g 的舌根动作，再把舌面抬高',
  じ: '先做带声 j 的擦塞音，再把舌面抬高',
  び: '先做带声 b 的双唇动作，再把舌面抬高',
  ぴ: '先做清音 p 的双唇动作，再把舌面抬高',
};

const YOON_BASE_CONFUSIONS: Record<string, string> = {
  き: '先和「きや」做拼写对照：小「ゃ」是合成一拍，大「や」会形成两拍',
  し: '「しゃ」和「ちゃ」都像 sha/cha；しゃ没有 t 的闭塞，ちゃ有先闭塞再摩擦的 ch 起音',
  ち: '「ちゃ」和「しゃ」都带 sh/ch 色彩；ちゃ有短暂闭塞，しゃ只有连续摩擦',
  に: '先和「にや」做拼写对照：小「ゃ」合成一拍，大「や」是完整第二拍',
  ひ: '「ひゃ」和「しゃ」都带舌面摩擦；ひゃ从 h 起音，しゃ从 sh 起音',
  み: '「みゃ」和「にゃ」都带 ya；みゃ先闭双唇发 m，にゃ先走鼻腔发 n',
  り: '先和「りや」做拼写对照：小「ゃ/ゅ/ょ」合成一拍，大假名会多出一拍',
  ぎ: '「ぎゃ」和「きゃ」结构相同；ぎゃ右上有浊点且声带振动，きゃ没有浊点',
  じ: '「じゃ」和「しゃ」都带 j/sh 色彩；じゃ有声，しゃ无声',
  び: '「びゃ」和「ぴゃ」都从双唇开始；びゃ带声，ぴゃ不带声且有圆圈',
  ぴ: '「ぴゃ」和「びゃ」都从双唇开始；ぴゃ是清音 p，びゃ是带声 b',
};

function buildKanaLearningGuide(kana: KanaItem): KanaLearningGuide {
  const examples = KANA_EXAMPLES[kana.id];
  const examplesField = examples ? { exampleWords: examples } : {};

  // 「を」在五十音表中仍归入わ行清音，但需要单独说明它的助词用法。
  if (kana.type === 'SPECIAL' || kana.hiragana === 'を') {
    if (kana.hiragana === 'を') {
      return {
        soundDescription:
          '「を」在现代标准日语中通常听作 o；记忆重点不是给它找词义，而是认出它常放在动作对象后面。',
        memoryTip: SEION_MEMORY_TIPS[kana.id] ?? '把「を」和动作的对象绑定，在短句中整体记。',
        pronunciationTip:
          PRONUNCIATION_TIPS[kana.id] ?? '作助词时直接发 o，短而清楚；不要为了拼写 wo 加出 w。',
        confusionNotes:
          CONFUSION_NOTES[kana.id] ?? '与「お」同音时看功能：「を」标记宾语，「お」是普通假名。',
        ...examplesField,
      };
    }
    return {
      soundDescription:
        '「ん」是一个鼻音拍：声音收在鼻腔，不像普通假名那样再打开固定的 a/i/u/e/o。',
      memoryTip: SEION_MEMORY_TIPS[kana.id] ?? '把「ん」记成鼻音收尾，不要给它强行补一个元音。',
      pronunciationTip:
        PRONUNCIATION_TIPS[kana.id] ?? '让声音收在鼻腔，不要读成“恩啊/恩嗯”等多余音节。',
      confusionNotes:
        CONFUSION_NOTES[kana.id] ?? '与「ね」「ぬ」对照：ん收在鼻音，ね/ぬ还会打开 e/u 元音。',
      ...examplesField,
    };
  }

  if (kana.type === 'YOON') {
    const baseKana = kana.hiragana.slice(0, -1);
    const smallKana = kana.hiragana.slice(-1);
    const glide = YOON_GLIDES[smallKana] ?? { kana: 'や', romaji: 'ya' };
    const baseArticulation =
      YOON_BASE_ARTICULATION[baseKana] ?? `先完成「${baseKana}」的辅音动作，再抬舌面`;
    const baseConfusion =
      YOON_BASE_CONFUSIONS[baseKana] ?? `与「${baseKana}${glide.kana}」对照小假名的大小和拍数`;
    return {
      soundDescription:
        `「${kana.hiragana}」把「${baseKana}」直接滑向 ${glide.romaji}，小「${smallKana}」让它合成一拍；不要读成 ${baseKana}-${glide.romaji} 两拍。`,
      memoryTip:
        `把大字「${baseKana}」和小「${smallKana}」绑在一起记：${baseKana} + ${smallKana} = ${kana.hiragana}。`,
      pronunciationTip:
        `${baseArticulation}，再滑向 ${glide.romaji} 的元音；小「${smallKana}」不单独占拍，中间不要停顿。`,
      confusionNotes:
        `${baseConfusion}；书写时确认「${smallKana}」明显小于「${glide.kana}」。`,
      ...examplesField,
    };
  }

  if (kana.type === 'DAKUON' || kana.type === 'HANDAKUON') {
    const baseKana = VOICING_BASE_BY_HIRAGANA[kana.hiragana] ?? '对应清音';
    const isHandakuon = kana.type === 'HANDAKUON';
    const mark = isHandakuon ? '半浊点「゜」' : '浊点「゛」';
    const vowelSound = VOWEL_SOUND_HANDLES[kana.col] ?? '对应元音';
    const vowelArticulation = VOWEL_ARTICULATION_TIPS[kana.col] ?? '保持元音口形稳定';

    if (kana.hiragana === 'ぢ' || kana.hiragana === 'づ') {
      const sameAs = kana.hiragana === 'ぢ' ? 'じ' : 'ず';
      return {
        soundDescription:
          `「${kana.hiragana}」是「${baseKana}」加浊点后的写法；现代标准日语中通常与「${sameAs}」同音或近同音，重点记词中的正确写法。`,
        memoryTip:
          `先认出清音「${baseKana}」，再记右上浊点和它在词中的拼写位置；不要把 dji/dzu 当成必须单独区分的音。`,
        pronunciationTip:
          `按「${sameAs}」的读法发声：${vowelArticulation}，让声带参与起音；不要刻意读出独立的 dji/dzu。`,
        confusionNotes:
          `与「${sameAs}」的差异主要在字形来源和词中拼写，现代标准语通常听不出稳定区别；看清「${kana.hiragana}」来自「${baseKana}」加浊点。`,
        ...examplesField,
      };
    }

    if (isHandakuon) {
      const voicedKana = HANDAKUON_VOICED_BY_HIRAGANA[kana.hiragana] ?? '对应ば行假名';
      return {
        soundDescription:
          `「${kana.hiragana}」听作清脆的 p + ${vowelSound}；圆圈表示它和带两点的「${voicedKana}」不是同一个清浊音。`,
        memoryTip:
          `先认出「${baseKana}」的字形，再把右上圆圈想成“气流清脆释放”的开关：圆圈在，读 p。`,
        pronunciationTip:
          `双唇完全闭合，声带不振动，释放 p 后接${vowelArticulation}；不要把圆圈漏掉而读成 b。`,
        confusionNotes:
          `与「${voicedKana}」对照：两者都先闭双唇，但${kana.hiragana}有圆圈、声带不振动，${voicedKana}有两点、声带振动。`,
        ...examplesField,
      };
    }

    const soundHandle = DAKUON_SOUND_HANDLES[kana.row] ?? `清音「${baseKana}」的起音加声带振动`;
    const articulation = DAKUON_ARTICULATION_TIPS[kana.row] ?? '先完成对应清音的辅音动作，再让声带振动';
    return {
      soundDescription:
        `「${kana.hiragana}」听作 ${kana.romaji}：${soundHandle}，再接${vowelSound}；右上浊点会改变起音的清浊。`,
      memoryTip:
        `先认出清音「${baseKana}」，再把右上浊点「゛」记成“声带打开”的开关：有浊点，读 ${kana.romaji}。`,
      pronunciationTip:
        `${articulation}，再接${vowelArticulation}；声带从起音处参与振动，但不要额外拖长。`,
      confusionNotes:
        `与清音「${baseKana}」对照：字形主体几乎相同，真正要找的是右上两个浊点，以及起音时声带是否振动。`,
      ...examplesField,
    };
  }

  const memoryTip =
    SEION_MEMORY_TIPS[kana.id] ??
    `先记住「${kana.hiragana}」的形状，再把它和 ${kana.romaji} 的声音绑定。`;
  const soundDescription =
    SOUND_DESCRIPTIONS[kana.id] ??
    `听 ${kana.romaji} 时，把${kana.row}的辅音和${kana.col}的元音连成一拍，确认起音和收尾。`;
  const pronunciationTip =
    PRONUNCIATION_TIPS[kana.id] ??
    `保持 ${kana.romaji} 短而清楚的一拍，元音口形稳定，不要拖长或加中文声调。`;
  const confusionNotes =
    CONFUSION_NOTES[kana.id] ??
    `把「${kana.hiragana}」和同一行的其他假名逐笔对照，再用 ${kana.romaji} 的起音确认；不要只凭模糊外轮廓猜。`;

  return {
    soundDescription,
    memoryTip,
    pronunciationTip,
    confusionNotes,
    ...examplesField,
  };
}

/**
 * 对外导出完整课程种子。讲义随课程资产一起进入 SQLite，旧库也会由 bootstrap 补齐。
 */
export const KANA_SEEDS: KanaItem[] = BASE_KANA_SEEDS.map((kana) => ({
  ...kana,
  learningGuide: buildKanaLearningGuide(kana),
}));
