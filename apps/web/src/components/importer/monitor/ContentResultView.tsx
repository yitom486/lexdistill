import type { ContentDirectoryNode, LessonContent } from '@lexdistill/document-model';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs.js';
import { StructuredLessonPanel } from '../../textbook/StructuredLessonPanel.js';
import { StructuredVocabularyList } from '../../textbook/StructuredVocabularyList.js';
import { StructuredExerciseList } from '../../textbook/StructuredExerciseList.js';

export function ContentResultView({ content, directory, counts }: { content: LessonContent; directory: readonly ContentDirectoryNode[]; counts?: { lines: number; vocabularies: number; knowledgePoints: number; exercises: number } }) {
  const headings = new Map(directory.map(node => [node.id, node.title]));
  const bindings = { directory };
  const referenced = [...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises, ...content.vocabularies.flatMap(item => item.examples), ...content.knowledgePoints.flatMap(item => item.examples)].filter(item => item.sourceRefs?.length);
  return <div className="space-y-3" data-testid="structured-result">
    <p>{counts ? '数据库派生行' : '候选内容数量'}：正文 {counts?.lines ?? content.blocks.length} · 生词 {counts?.vocabularies ?? content.vocabularies.length} · 知识点 {counts?.knowledgePoints ?? content.knowledgePoints.length} · 习题 {counts?.exercises ?? content.exercises.length}</p>
    <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer">目录覆盖与字段存放位置</summary>
      <table className="mt-2 w-full text-left"><thead><tr><th>目录</th><th>提交状态</th><th>关联内容</th></tr></thead><tbody>{content.coverage.map(entry => <tr key={entry.tocId}><td>{headings.get(entry.tocId) ?? entry.tocId}</td><td>{entry.status === 'EXTRACTED' ? '报告已提取' : '无法辨认'}</td><td>{[...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises].filter(item => item.tocId === entry.tocId).length}</td></tr>)}</tbody></table>
      <p className="mt-2 text-ink-muted">章节内容由教材学习表保存；这里展示文件导入内容。保存状态以数据库回执为准。</p>
    </details>
    {!!referenced.length && <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer">原书来源定位 · {referenced.length} 项</summary>
      <p className="text-ink-muted">来源引用保存在规范 AST 和章节 content_json；定位合法不等于语义已核实。</p>
      <table className="mt-2 w-full text-left"><thead><tr><th>内容 ID</th><th>目录</th><th>原页／块／行</th></tr></thead><tbody>{referenced.map(item => <tr key={item.id}><td>{item.id}</td><td>{headings.get(item.tocId ?? '') ?? item.tocId}</td><td>{item.sourceRefs?.map(ref => `第 ${ref.page} 页 · ${ref.blockId}${ref.row !== undefined ? ' · 行 ' + ref.row : ''}`).join('；')}</td></tr>)}</tbody></table>
    </details>}
    <Tabs defaultValue="body"><TabsList className="flex flex-wrap"><TabsTrigger value="body">正文</TabsTrigger><TabsTrigger value="vocab">生词</TabsTrigger><TabsTrigger value="knowledge">知识点与讲解</TabsTrigger><TabsTrigger value="exercises">习题</TabsTrigger></TabsList>
      <TabsContent value="body"><StructuredLessonPanel content={content} tab="READER" {...bindings} /></TabsContent>
      <TabsContent value="vocab"><StructuredVocabularyList words={content.vocabularies} {...bindings} /></TabsContent>
      <TabsContent value="knowledge"><StructuredLessonPanel content={content} tab="GRAMMAR" {...bindings} /></TabsContent>
      <TabsContent value="exercises"><StructuredExerciseList exercises={content.exercises} {...bindings} /></TabsContent>
    </Tabs>
  </div>;
}
