import type { TextbookExerciseAttempt } from '@lexdistill/protocol';
import { Button } from '../../ui/button.js';

export function ExerciseGradingFeedback({ result, onRetry }: { result: TextbookExerciseAttempt; onRetry: () => void }) {
  return <div className="mt-4 space-y-2 rounded-xl border border-line-soft bg-surface-warm p-4" role="status">
    {result.grading ? <>
      <p className="font-medium">{result.grading.score} / {result.grading.maxScore} 分{result.model ? ` · ${result.model}` : ' · 自动判题'}</p>
      <p className="whitespace-pre-wrap text-sm leading-7">{result.grading.feedback}</p>
      {!!result.grading.suggestions.length && <ul className="list-disc space-y-1 pl-5 text-sm">{result.grading.suggestions.map((suggestion, i) => <li key={i}>{suggestion}</li>)}</ul>}
      {result.grading.revisedAnswer && <details><summary className="cursor-pointer text-sm text-accent-ink">参考改写</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{result.grading.revisedAnswer}</p></details>}
      <p className="text-xs text-ink-muted">{result.temporary ? '临时案例，本次结果不会写入正式学情。' : `已保存第 ${result.attemptNo} 次作答 · ${result.submissionKind === 'REVISION' ? '修改后作答' : '独立练习'}`}</p>
    </> : <>
      <p className="font-medium">未评分 · 答案已保留</p>
      <p className="text-sm text-ink-muted">{result.gradingErrorCode === 'E_GRADING_MODEL_REQUIRED' ? '请先选择批改模型。' : result.gradingErrorCode?.includes('TIMEOUT') ? '模型等待超时，可以重试这份作答。' : result.gradingErrorCode?.includes('QUOTA') ? '模型额度不足，请恢复额度或选择其他模型后重试。' : '批改没有完成，可以重试；不会计为零分。'}</p>
      <Button variant="outline" onClick={onRetry}>重试批改</Button>
    </>}
  </div>;
}
