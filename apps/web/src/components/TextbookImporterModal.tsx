import { useState } from 'react';
import {
  BookOpen,
  Layers,
  ArrowRight,
  Code2,
  FileUp,
  AlertCircle,
  Maximize2,
  Minimize2,
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
import { useJsonImportAction } from './importer/useJsonImportAction.js';
import { parseTextbookAST } from '@study-studio/document-model';

interface TextbookImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBook: (importedBook: TextbookBook, generatedCardsCount: number) => void | Promise<unknown>;
  onAddCardsBatch: (cards: { front: string; back: string; category: string; prompt: string }[]) => void | Promise<unknown>;
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
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
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

  const jsonImport = useJsonImportAction({ parsedAST, autoGenerateCards, onImportBook, onAddCardsBatch, onClose });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`overflow-hidden flex flex-col p-0 gap-0 bg-surface-warm text-ink transition-all duration-[var(--motion-dialog-expand-duration)]
          ${isExpanded 
            ? 'w-[96vw] max-w-[96vw] h-[94vh] max-h-[94vh] rounded-2xl' 
            : 'w-[92vw] max-w-5xl lg:max-w-6xl h-[88vh] max-h-[88vh] rounded-2xl'
          }`}
        showCloseButton
      >
        <DialogHeader className="px-6 py-4.5 border-b border-line-soft bg-paper-soft text-left shrink-0">
          <div className="flex items-center justify-between pr-10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-surface border border-line text-ink">
                <BookOpen className="w-5 h-5 text-accent-ink" />
              </div>
              <div>
                <DialogTitle className="font-serif text-lg font-bold text-ink">
                  教材导入
                </DialogTitle>
                <DialogDescription className="text-xs text-ink-muted">
                  选取教材、对齐目录物理页码，调动 Agent 并发池进行多会话结构化提炼入库。
                </DialogDescription>
              </div>
            </div>

            {/* 宽屏全屏视界切换按钮 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-ink-muted hover:text-ink hidden md:flex items-center gap-1.5 h-8 px-2.5"
              title={isExpanded ? '缩小窗口' : '沉浸全屏'}
            >
              {isExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>还原</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>宽屏大视界</span>
                </>
              )}
            </Button>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => { if (value === 'pipeline' || value === 'json') setActiveTab(value); }}
          className="w-full flex-1 flex flex-col min-h-0"
        >
          <div className="px-6 pt-2 pb-0 border-b border-line flex items-center justify-between bg-surface shrink-0">
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
              <div className="p-3.5 rounded-xl bg-status-rose-wash border border-status-rose-line-soft flex items-start gap-2.5 text-status-rose-fg text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="leading-relaxed">{parseError}</span>
              </div>
            )}

            {activeTab === 'json' && parsedAST && (
              <div className="p-4 rounded-2xl bg-status-warn-wash border border-status-warn-line-soft flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-accent-ink" />
                    自动为全课生词生成 FSRS 记忆卡片
                  </div>
                  <p className="text-xs text-ink-muted">
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

        {activeTab === 'json' && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-line-soft bg-paper-soft shrink-0">
            <Button variant="ghost" onClick={onClose} className="text-xs">
              取消
            </Button>
            {jsonImport.error && <p role="alert" className="text-xs text-ink-rose-600">{jsonImport.error}</p>}
            <Button disabled={!parsedAST || jsonImport.pending} onClick={() => void jsonImport.confirm()} className="text-xs">
              {jsonImport.pending ? '正在保存教材…' : '确认导入并激活'}
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
