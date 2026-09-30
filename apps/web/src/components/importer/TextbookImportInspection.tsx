import type { TextbookInspectionDocSummary, TextbookInspectionResult } from '@study-studio/protocol';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';

interface Props {
  result: TextbookInspectionResult | undefined;
  document: TextbookInspectionDocSummary | undefined;
  pending: boolean;
  error: Error | null;
  onRecheck: () => void;
  onContinue: () => void;
  onUse: ((documentId: string) => void) | undefined;
}

/** 所有数量和逐课状态均来自 Gateway 的实际数据库查询。 */
export function TextbookImportInspection({ result, document: doc, pending, error, onRecheck, onContinue, onUse }: Props) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-xs" aria-label="教材导入检测">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-ink">已导入内容检测</span>
        <Button size="sm" variant="outline" disabled={pending} onClick={onRecheck}>
          {pending ? '正在检测…' : '重新检测'}
        </Button>
      </div>
      {error && <p role="alert" className="text-ink-rose-700-rose-400">{error.message}</p>}
      {!error && result && (!doc || doc.documentId === result.matchedDocument?.documentId) && <p className="text-ink-muted">{result.summary}</p>}
      {doc && (
        <div className="space-y-3">
          <p className="font-semibold text-ink">
            {doc.outlineConfirmed && !doc.hasShreddedAssets ? `《${doc.title}》的目录已保存，正文尚未提取` : `已导入《${doc.title}》：${doc.readyLessonCount}/${doc.lessonCount} 个部分就绪`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">正文 {doc.passageLessonCount} 个部分 / {doc.lineCount} 行</Badge>
            <Badge variant="secondary">生词 {doc.vocabCount} 个</Badge>
            <Badge variant="secondary">语法 {doc.grammarCount} 项</Badge>
            <Badge variant="secondary">习题 {doc.exerciseCount} 道</Badge>
          </div>
          <p className="text-ink-muted">
            已通过文件指纹确认是同一份 PDF。
            {doc.outlineConfirmed ? '完成情况以已确认目录为准，请对照原书核对内容。' : '目录尚未确认。'}
          </p>
          <details className="rounded-xl border border-line p-3" open>
            <summary className="cursor-pointer font-semibold text-ink">按目录核对已保存内容</summary>
            <div className="mt-2 max-h-64 overflow-auto">
              <table className="w-full text-left">
                <thead><tr className="text-ink-muted">
                  <th className="p-1">课次 / 部分</th><th className="p-1">状态</th><th className="p-1">正文</th>
                  <th className="p-1">生词</th><th className="p-1">语法</th><th className="p-1">习题</th>
                  <th className="p-1">预习 / 总结</th>
                </tr></thead>
                <tbody>{doc.lessonDetails.map((lesson) => (
                  <tr key={lesson.lessonId} className="border-t border-line-soft text-ink">
                    <td className="p-1.5">{lesson.title}</td>
                    <td className="p-1.5">{lesson.status === 'ready' ? '已就绪' : lesson.status === 'failed' ? '未完成' : '待提取'}</td>
                    <td className="p-1.5">{lesson.hasPassage ? '已保存' : '未保存'}</td>
                    <td className="p-1.5">{lesson.vocabCount}</td><td className="p-1.5">{lesson.grammarCount}</td><td className="p-1.5">{lesson.exerciseCount}</td>
                    <td className="p-1.5">{lesson.hasPreview ? '已保存' : '未保存'} / {lesson.hasSummary ? '已保存' : '未保存'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
          <p className="text-ink-muted">数量为 0 表示当前未保存该类内容；是否原书没有该项，请按课核对。</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onContinue}>继续检查目录</Button>
            <Button size="sm" disabled={!onUse || !doc.hasShreddedAssets} onClick={() => onUse?.(doc.documentId)}>打开已导入内容</Button>
          </div>
        </div>
      )}
    </section>
  );
}
