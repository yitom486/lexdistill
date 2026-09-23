# modules/learning-progress — 学习进度领域

画像、技能指标、每日计划/活动、错题生命周期、学习分析编排、练习成绩回写。
今日计划只消费运行进度，不拥有练习模板与运行。

| 路径 | 内容 |
|---|---|
| `persistence/` | profile、profile-internals、mistakes、activity-plan、learning-records（假名/阅读成绩回写） |
| `application/` | learning-analysis（分析快照） |
| `tools/` | learning-progress |
| `http/` | 画像/任务/计划/错题/分析路由 |
| `websocket/` | 画像读取/更新、每日进度读取/活动记录的 WS 协议适配；通过 `public.ts` 暴露给 Gateway Runtime |
