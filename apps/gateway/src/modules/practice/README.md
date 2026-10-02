# modules/practice — 练习领域模块（G1 试点）

练习模板、运行、装配、提交、复盘归属本模块（G2 路由与 G4 persistence 已归位）。

| 路径 | 内容 |
|---|---|
| `application/practice-assembly.ts` | 按块装配题目；通过 learning-content 的 public API type-only 消费 `learning.content` 输入输出契约 |
| `application/practice-grading.ts` | 客观题权威判题纯函数，无内部依赖 |
| `application/practice-proposal.ts` | AI 建议 propose + 用户确认 apply（TTL、一次性消费；依赖 learning-progress 的 `AnalysisSnapshot` 类型） |
| `application/practice-summary.ts` | 运行复盘（只读 run + attempts，AI/local 双源），仅依赖 packages |
| `persistence/` | practice-plan、practice、questions（题库读写与作答记录；G4 由 cards-questions 拆分而来） |
| `__tests__/` | assembly / grading / phase-d 单模块测试；`practice-collect.test.ts` 仍在根 `__tests__`（测 HTTP，需 `app`） |
| `tools/` | learning-practice、learning-assess、grade-subjective-quiz、generate-adaptive-quiz（G3 已归组，公开 name/schema 不变） |
| `http/` | 练习域路由（G2 已抽取） |
| `websocket/` | quiz submit、adaptive generate、subjective grade 的 WS 协议适配；依赖经窄接口注入，并由 `public.ts` 暴露给 Gateway Runtime |

依赖说明：`application/practice-assembly.ts` 经结构化 `ContentToolLike`
消费内容生成能力，只从 `modules/learning-content/public.ts` type-only 导入契约，
不依赖 Tool 实现；练习 HTTP 与 Agent Tool 共用同一应用能力。

教材练习新增入口：`POST /api/textbook-practice/:userId/submit`、`GET /api/textbook-practice/:userId/history`。
`application/textbook-grading.ts` 组装冻结上下文，只注入 `learning.submit_grade`；模型填写批改内容，系统绑定身份。
SQLite 通过 `learner-core/TextbookPracticeRepository` 命令保存每次正式作答、实际模型审计和幂等统计；失败无分数，临时案例不写正式学情。
`GET /api/textbook-practice/:userId/growth?documentId=…&chapterId=…` 从同一份正式历史计算成长摘要，不建立重复统计表。按章节、题型、难度、独立/修改作答、实际模型及评分版本分别计算样本数、均分、满分率和已记录的交互耗时；未知难度保持未知，未评分和临时作答不参与均分。相邻修改仅在题目快照和模型/评分版本一致时标为可直接比较。
`quiz.gradeSubjective` 的旧规则路径不参与这条教材 AI 批改链路。
