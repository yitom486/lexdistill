import { useState } from 'react';
import {
  BookOpen,
  Layers,
  ArrowRight,
  Code2,
  FileUp,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TextbookAST } from '@study-studio/document-model';
import { sound } from '../utils/audio.js';
import type { TextbookBook } from '../models/textbook.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Switch } from './ui/switch.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs.js';
import { TextbookJsonImporterTab } from './importer/TextbookJsonImporterTab.js';
import { TextbookPipelineImporterTab } from './importer/TextbookPipelineImporterTab.js';
import { convertAstToTextbookBook, extractFsrsCardsFromAst } from './importer/textbook-converter.js';
import { parseTextbookAST } from '@study-studio/document-model';

interface TextbookImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBook: (importedBook: TextbookBook, generatedCardsCount: number) => void;
  onAddCardsBatch: (cards: { front: string; back: string; category: string; prompt: string }[]) => void;
  /** 已有教材（接力追加用；无 documentId 的未入库书不列入） */
  existingBooks?: Array<{ documentId: string; title: string; lessons: number }>;
  /** 直接激活选择已入库教材 */
  onSelectBook?: ((documentId: string) => void) | undefined;
}

export function TextbookImporterModal({
  isOpen,
  onClose,
  onImportBook,
  onAddCardsBatch,
  existingBooks = [],
  onSelectBook,
}: TextbookImporterModalProps) {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'json'>('pipeline');
  const [inputText, setInputText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedAST, setParsedAST] = useState<TextbookAST | null>(null);
  const [autoGenerateCards, setAutoGenerateCards] = useState<boolean>(true);

  // 文件状态（共享于流水线面板）
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPath, setPdfPath] = useState<string>('');
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [pdfFileError, setPdfFileError] = useState<string | null>(null);
  const [docPath, setDocPath] = useState<string>('');
  const [docUrl, setDocUrl] = useState<string>('');
  const [docNote, setDocNote] = useState<string | null>(null);

  const handleSelectJsonFile = (fileOrPath: File | string) => {
    setActiveTab('json');
    if (typeof fileOrPath === 'string') {
      toast.info(`已切换至 JSON 导入面板`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setInputText(content);
      try {
        const raw = JSON.parse(content);
        const res = parseTextbookAST(raw);
        if (res.ok) {
          setParseError(null);
          setParsedAST(res.value);
          sound.playCorrect();
          toast.success(`成功载入教材文档: 《${res.value.title}》`);
        } else {
          setParseError(res.error.userMessage);
          setParsedAST(null);
        }
      } catch {
        setParseError('读取的文件并非标准 JSON 格式，请检查');
        setParsedAST(null);
      }
    };
    reader.readAsText(fileOrPath);
  };

  const handleConfirmImport = () => {
    if (!parsedAST) return;
    sound.playCorrect();

    const convertedBook = convertAstToTextbookBook(parsedAST);
    let totalCardsCount = 0;
    if (autoGenerateCards) {
      const generatedCards = extractFsrsCardsFromAst(parsedAST);
      if (generatedCards.length > 0) {
        onAddCardsBatch(generatedCards);
        totalCardsCount = generatedCards.length;
      }
    }

    onImportBook(convertedBook, totalCardsCount);
    toast.success(
      `成功导入《${convertedBook.title}》！已收录 ${convertedBook.lessons.length} 课${totalCardsCount > 0 ? `，生成 ${totalCardsCount} 张 FSRS 记忆卡片` : ''}`
    );
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-surface-warm text-ink"
        showCloseButton
      >
        <DialogHeader className="px-6 py-5 border-b border-line-soft bg-paper-soft text-left">
          <div className="flex items-center gap-2.5 pr-8">
            <div className="p-2 rounded-xl bg-surface border border-line text-ink">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-serif text-xl text-ink">
                导入教材
              </DialogTitle>
              <DialogDescription className="text-xs text-ink-muted">
                选择教材，核对目录，再整理成可学习的内容。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => { if (value === 'pipeline' || value === 'json') setActiveTab(value); }}
          className="w-full flex-1 flex flex-col min-h-0"
        >
          <div className="px-6 pt-2 pb-0 border-b border-line flex items-center justify-between">
            <TabsList className="h-9">
              <TabsTrigger value="pipeline" className="text-xs gap-1.5">
                <FileUp className="w-3.5 h-3.5" />
                教材文件
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs gap-1.5">
                <Code2 className="w-3.5 h-3.5" />
                JSON 内容
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6 overflow-y-auto space-y-4 flex-1">
            <TabsContent value="pipeline" className="mt-0">
              <TextbookPipelineImporterTab
                pdfFile={pdfFile}
                setPdfFile={setPdfFile}
                pdfPath={pdfPath}
                setPdfPath={setPdfPath}
                docPath={docPath}
                setDocPath={setDocPath}
                docUrl={docUrl}
                setDocUrl={setDocUrl}
                pdfNote={pdfNote}
                setPdfNote={setPdfNote}
                pdfFileError={pdfFileError}
                setPdfFileError={setPdfFileError}
                docNote={docNote}
                setDocNote={setDocNote}
                setParseError={setParseError}
                parsedAST={parsedAST}
                setParsedAST={setParsedAST}
                setInputText={setInputText}
                existingBooks={existingBooks}
                onClose={onClose}
                onSelectJsonFile={handleSelectJsonFile}
                {...(onSelectBook ? { onSelectBook } : {})}
              />
            </TabsContent>

            <TabsContent value="json" className="mt-0">
              <TextbookJsonImporterTab
                inputText={inputText}
                setInputText={setInputText}
                parsedAST={parsedAST}
                setParsedAST={setParsedAST}
                setParseError={setParseError}
              />
            </TabsContent>

            {parseError && (
              <div className="p-3 rounded-xl bg-wash-rose-500o10 border border-line-rose-500o20 flex items-start gap-2 text-ink-rose-700-rose-400 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{parseError}</span>
              </div>
            )}

            {activeTab === 'json' && parsedAST && (
              <div className="p-4 rounded-2xl bg-wash-amber-500o10 border border-line-amber-900o10-amber-500o20 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-accent-ink" />
                    自动为全课生词生成 FSRS 记忆卡片
                  </div>
                  <p className="text-[11px] text-ink-ghost">
                    将提取{' '}
                    {parsedAST.lessons.reduce((acc, l) => acc + l.vocabularies.length, 0)}{' '}
                    个生词直接注入今日复习池
                  </p>
                </div>
                <Switch aria-label="自动生成记忆卡片" checked={autoGenerateCards} onCheckedChange={setAutoGenerateCards} />
              </div>
            )}
          </div>
        </Tabs>

        {activeTab === 'json' && <div className="flex items-center justify-between px-6 py-4 border-t border-line-soft bg-paper-soft">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!parsedAST} onClick={handleConfirmImport}>
            确认导入并激活
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
