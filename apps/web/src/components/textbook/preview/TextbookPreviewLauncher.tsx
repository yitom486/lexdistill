import { lazy, Suspense, useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog.js';

// Only load the temporary fixture when the user explicitly opens the development preview.
const Preview = import.meta.env.DEV ? lazy(async () => {
  const [{ LearningPreviewPage }, { previewLesson }] = await Promise.all([
    import('./LearningPreviewPage.js'), import('../../../fixtures/textbook-learning-preview.js'),
  ]);
  return { default: () => <LearningPreviewPage {...previewLesson} /> };
}) : null;

export function TextbookPreviewLauncher() {
  const [open, setOpen] = useState(false);
  return <><Button variant="outline" size="sm" onClick={() => setOpen(true)}><Eye className="h-3.5 w-3.5" />学习页面预览</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[min(900px,92vh)] w-[96vw] max-w-[1440px] flex-col gap-0 overflow-hidden p-0" aria-describedby="learning-preview-description">
        <DialogTitle className="sr-only">教材学习页面预览</DialogTitle>
        <DialogDescription id="learning-preview-description" className="sr-only">使用临时演示内容查看学习交互，不修改数据库。</DialogDescription>
        {open && Preview && <Suspense fallback={<p className="p-9 text-sm text-ink-muted">正在打开学习预览…</p>}><Preview /></Suspense>}
      </DialogContent>
    </Dialog>
  </>;
}
