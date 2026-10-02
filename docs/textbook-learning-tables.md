# 教材学习内容表与简单工具

更新：2026-10-02。版本：数据库 v39（内容表始于 v37）。目标是保存可直接学习的内容。

## 模型和系统的分工

模型只填写标题、正文、释义、讲解、例句、题干和参考答案。系统绑定用户、教材和章节，生成内容 ID、排序和时间。调用校验后暂存，模型正常结束后统一事务保存；所有内容类别均按本章实际内容选择，有则提交、无则省略，至少提交一类有效学习内容。不要求小目录覆盖。

五类学习内容加整理材料、全局词汇，共七张表。公共词典包与个人全局词汇不同：公共词典仍为查询来源，全局词汇用于同一学习者跨教材复用词汇身份。

## 通用内容字段

下列五张章节内容表均有这些系统字段，模型不填写：

| 字段 | 含义 |
| --- | --- |
| id | 内容唯一身份，由系统生成；已有内容迁移保留可用 ID |
| document_id | 所属教材，关联 documents.id |
| chapter_id | 所属章节，由当前会话绑定 |
| ord | 本章同类内容的展示顺序，从 0 起 |

带 source 的内容表只在调用组上标注来源：TEXTBOOK 为原书整理，AI 为新增内容，不要求每个嵌套字段声明来源。

## 1. global_vocabulary：个人全局词汇

| 字段 | 含义 |
| --- | --- |
| id | 全局词汇身份，系统生成 |
| user_id | 学习者归属 |
| language | 语种 |
| word | 词形 |
| reading | 读音；未提供时为空字符串，参与去重 |
| meaning | 首次登记的释义 |
| jlpt_level | 模型估计的 N5、N4、N3、N2 或 N1；迁移时没有词汇级别证据则为空 |
| level_source | MODEL_ESTIMATE 表示模型估计；未知时为空 |
| created_at | 首次登记时间 |

唯一键为 user_id + language + word + reading。新词自动新增；已有词复用原 ID，不覆盖释义或等级。同词不同读音可以分别保存。词汇等级是学习难度，不是掌握度，不属于官方等级认证。

用户的实际掌握情况仍由既有学习记录、encountered_terms 和复习系统保存；这些资产通过用户、语种、词形和读音关联，导入不会凭空增加掌握度。

## 2. textbook_vocabulary：本章词汇

除通用字段外：

| 字段 | 含义 |
| --- | --- |
| vocabulary_id | 关联全局词汇 ID |
| meaning | 本章语境中的词义 |
| part_of_speech | 可选词性 |
| pitch | 可选音调，无法确认不猜 |
| explanation | 可选词汇讲解 |
| examples_json | 例句列表，每项为 text 和可选 translation |

同一教材、章节、全局词汇只保存一条关联。同一个词在不同章节可以各有语境释义和例句。

## 3. textbook_knowledge：语法、发音与用法知识

除通用字段外：

| 字段 | 含义 |
| --- | --- |
| kind | GRAMMAR、PRONUNCIATION 或 USAGE |
| title | 知识点标题 |
| explanation | 原书整理的说明；AI 新增条目则为该条目的说明 |
| connection | 可选接续规则 |
| ai_explanation | 独立的 AI 补充讲解 |
| examples_json | 例句列表：text、可选 translation |
| source | 条目来源 TEXTBOOK 或 AI |

显示顺序固定为标题、说明、接续、AI 补充、例句；讲解不混入文章正文。

## 4. textbook_articles：完整文章或会话

除通用字段外：

| 字段 | 含义 |
| --- | --- |
| title | 可选标题 |
| text | 完整整理后的正文，保留上下文 |
| translation | 可选独立译文 |
| source | TEXTBOOK 或 AI |

完整会话可以作为文章保存，不能把每一行机械拆成一篇文章。

## 5. textbook_sentences：独立学习句子

除通用字段外：

| 字段 | 含义 |
| --- | --- |
| text | 句子 |
| translation | 可选译文 |
| explanation | 可选讲解 |
| speaker | 可选说话人 |
| source | TEXTBOOK 或 AI |

没有独立句子则为空，界面不展示空分类。

## 6. textbook_exercise_items：练习内容

除通用字段外：

| 字段 | 含义 |
| --- | --- |
| type | CHOICE、MULTI_CHOICE、FILL_BLANK、TRANSLATION、ORDERING、MATCHING、SHORT_ANSWER 或 WRITING |
| prompt | 题干 |
| options_json | 选择或排序题的文字选项列表 |
| left_json / right_json | 匹配题的左右文字列表 |
| answer_json | 客观题答案：文字、按空位/词序排列的文字列表或 left/right 配对；主观题可存参考表达，也可为 NULL |
| explanation | 可选题目解析 |
| grading_notes | 主观题必填的评分要求；客观题可省略 |
| difficulty_tier | 模型估计的题目复杂度整数 1–5；已有未知值为 NULL，新写入不能使用默认难度 |
| difficulty_reason | 一句难度依据，不等同 JLPT 等级或个人掌握度 |
| source | TEXTBOOK 或 AI |

选择题答案填写实际选项文字，系统检查对应关系；模型不生成选项 ID 或数组关联下标。评分结果与个人作答不能写进教材题目表。

多空填空按空位保存答案数组；排序允许相同文字的不同词块，校验出现次数；配对允许复用右项。主观题按评分要求接受等价表达。

### 作答、批改与统计（v39）

- `practice_item_attempts` 保存每份正式答案：`attempt_no` 为版本序号、`previous_attempt_id` 指向修改前作答、`submission_kind` 区分独立练习和修改；`question_snapshot_json` 冻结题干、参考表达、评分要求、难度和本章知识。
- `status` 区分 SUBMITTED、GRADING、GRADED、GRADING_FAILED。`grading_result_json` 只保存通过校验的 score/maxScore/feedback/suggestions/可选 revisedAnswer；失败保留答案且无分数。`grading_run_id` 关联实际模型审计，`grading_error_code` 保留失败类型。
- `quiz_attempts` 以唯一 `source_attempt_id` 关联有效作答；`document_id`、`chapter_id`、`difficulty_tier`、`submission_kind` 保存当次统计维度，`max_score` 明确分值尺度。新链路为 0–100；已有未知尺度不猜测、不混算。
- 模型仅通过 `learning.submit_grade` 提交批改内容。用户、题目、版本、运行身份和统计关联由系统绑定；事务提交成功才给工具成功回执。技术重试沿用同一作答，迟到调用拒绝；临时案例不写正式记录。
- 客观题在 Gateway 自动判题；翻译、简答、写作使用用户选择的实际模型，没有启发式评分回退。没有可靠考点关联时不更新某个语法的掌握度；难度权重公式须另行批准。

## 7. textbook_materials：整理后的章节材料

| 字段 | 含义 |
| --- | --- |
| document_id | 当前教材 |
| chapter_id | 当前章节 |
| text | 整理后的材料，可有标题、列表、表格 |
| updated_at | 最后更新时间 |

document_id + chapter_id 为联合主键；再次写入替换该章材料。它是独立阅读/查询材料，不是另一份学习内容底稿，不保存原页图片。

## documents 新增的元信息

| 字段 | 含义 |
| --- | --- |
| chapters_json | 章节列表；每项有系统 id、title、order、kind、startPage、endPage、status |
| source_fingerprint | 本地文件指纹，用于检测同文件重复导入 |

页码只用于内部切分和核对，模型内容工具无需填写。状态 ready 与内容在同一事务保存，前提是模型轮次正常结束、工具调用已处理完、至少提交一类有效学习内容且没有未修正的操作错误。只查询或新增后删空不算本轮提交。暂存回执不代表数据库已保存。

教材不再重复存全书 ast_json 和拼接正文 content；非教材的新闻、阅读文档用途保留。读取层按现有接口生成视图，不保存第二份内容。

## 原生工具

| 工具 | 模型填写 |
| --- | --- |
| library.knowledge | items：标题、说明、知识类型、可选接续/AI 讲解/例句；组级 source；按实际内容选择 |
| library.vocabulary | items：词形、读音、释义、N5–N1 等级、可选词性/音调/讲解/例句；按实际内容选择 |
| library.articles | items：正文、可选标题/译文；组级 source；可选 |
| library.sentences | items：句子、可选译文/讲解/说话人；组级 source；可选 |
| library.exercises | items：题型、题干、难度 1–5 及估计依据、客观题答案与必要选项；开放题评分要点及可选参考答案/解析；组级 source；按实际内容选择 |
| library.material | items 中填写 text；本课最多一份整理材料；可选 |

每个工具均支持 action=add/read/update/delete，默认 add。新增只填写内容；read 返回本课已有内容加暂存变更及短引用 ref，update 在 items 中填 ref 和完整内容，delete 填 refs。短引用只在当前课、当前尝试有效，不是数据库 ID；重复原生 callId 不重复操作。

回执 status=staged 表示已校验并暂存，status=view 表示查询当前视图。模型正常结束后由调度器校验并统一提交内容、全局新词、FTS 和 ready 状态。取消、超时或异常结束丢弃本轮暂存；数据库暂时失败仅重试同一候选。重新提取的旧内容也在最终事务中替换，失败保留旧版本。删除章节词汇不删除全局词和其他学习资产。

运行时原生名称将点号转换为下划线，如 library_vocabulary。引擎收到实际工具说明和参数定义；提示词不重复粘贴 JSON Schema。旧统一提交和分批立即写入工具入口均已删除，无兼容工具。

## 迁移与检验

v37 将旧内容一次转入，随后删除 textbook_lessons、textbook_lines、textbook_vocab、textbook_grammar、textbook_exercises。小节内容归入保留章节，完整例句和练习答案转换；旧词没有可证实等级则不猜。已发布旧迁移保留，仅用于升级历史数据库，不作为运行时兼容入口。

本次迁移逐条执行静态 SQL，处于同一事务内；任一转换失败必须回滚且不得登记成功。旧模型在不同章节重复生成的 ID 由系统重新分配；选择题答案从规范题目中的选项身份转为选项文字。FTS 是可重建索引，内容表才是事实源。

集成验收包括真实 SQLite 迁移与回滚、重复初始化、原生工具写入/读取、全局词汇去重、不同用户隔离、多章并发、迟到调用拒绝、修正与保存重试、桌面 Query→Gateway→SQLite 显示。模型输出受控，测试不证明真实模型对教材的语义整理质量。

迁移取证曾确认旧词汇45条、知识点76条、段落120条、对话88条、练习24道、材料22份；这只证明字段和数量转换，不代表符合新学习内容定义。旧段落仍混有讲解和例句，旧发音知识被统一标作语法，旧词无等级，不能把它们称为按新流程生成的有效内容。

2026-10-02 经用户明确批准，已清空实际桌面库中这本教材的六类内容、全文索引，以及仅被该教材引用的45个全局词汇。已确认目录保留，30部分全部重置 pending；重新提取必须使用当前七个简单工具。其他文档、词卡和学习记录不在本次清理范围。实际 SQLite 完整性/外键检查及 Gateway 查询均确认清理结果。

全库 doctor 另检出 172 条既有词典条目的来源悬空，恢复前后相同，不属于本次教材迁移范围。
