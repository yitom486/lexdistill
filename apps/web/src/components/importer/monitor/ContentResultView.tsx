import type { ContentDirectoryNode, LessonContent } from '@study-studio/document-model';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs.js';
import { StructuredLessonPanel } from '../../textbook/StructuredLessonPanel.js';
import { StructuredVocabularyList } from '../../textbook/StructuredVocabularyList.js';
import { StructuredExerciseList } from '../../textbook/StructuredExerciseList.js';

export function ContentResultView({ content, directory, counts }: { content: LessonContent; directory: readonly ContentDirectoryNode[]; counts?: { lines: number; vocabularies: number; knowledgePoints: number; exercises: number } }) {
  const headings = new Map(directory.map(node => [node.id, node.title]));
  const bindings = { directory };
  return <div className="space-y-3" data-testid="structured-result">
    <p>{counts ? '数据库派生行' : '候选内容数量'}：正文 {counts?.lines ?? content.blocks.length} · 生词 {counts?.vocabularies ?? content.vocabularies.length} · 知识点 {counts?.knowledgePoints ?? content.knowledgePoints.length} · 习题 {counts?.exercises ?? content.exercises.length}</p>
    <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer">目录覆盖与字段存放位置</summary>
      <table className="mt-2 w-full text-left"><thead><tr><th>目录</th><th>提交状态</th><th>关联内容</th></tr></thead><tbody>{content.coverage.map(entry => <tr key={entry.tocId}><td>{headings.get(entry.tocId) ?? entry.tocId}</td><td>{entry.status === 'EXTRACTED' ? '报告已提取' : '无法辨认'}</td><td>{[...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises].filter(item => item.tocId === entry.tocId).length}</td></tr>)}</tbody></table>
      <p className="mt-2 text-ink-muted">底稿：documents.ast_json；目录：textbook_lessons；正文：textbook_lines；生词：textbook_vocab；知识点：textbook_grammar；习题：textbook_exercises。同一事务派生，覆盖自述不代替提交回执。</p>
    </details>
    <Tabs defaultValue="body"><TabsList className="flex flex-wrap"><TabsTrigger value="body">正文</TabsTrigger><TabsTrigger value="vocab">生词</TabsTrigger><TabsTrigger value="knowledge">知识点与讲解</TabsTrigger><TabsTrigger value="exercises">习题</TabsTrigger></TabsList>
      <TabsContent value="body"><StructuredLessonPanel content={content} tab="READER" {...bindings} /></TabsContent>
      <TabsContent value="vocab"><StructuredVocabularyList words={content.vocabularies} {...bindings} /></TabsContent>
      <TabsContent value="knowledge"><StructuredLessonPanel content={content} tab="GRAMMAR" {...bindings} /></TabsContent>
      <TabsContent value="exercises"><StructuredExerciseList exercises={content.exercises} {...bindings} /></TabsContent>
    </Tabs>
  </div>;
}
