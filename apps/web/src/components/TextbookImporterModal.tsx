import React, { useState } from 'react';
import {
  Upload,
  Download,
  FileText,
  FileUp,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  BookOpen,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseTextbookAST, type TextbookAST } from '@study-studio/protocol';
import { useImportPdfMutation, useMapPdfMutation, useAppendPdfMutation, useImportDocumentMutation, useClassifyStructureMutation, useSaveDocumentStructureMutation, type StructureClassItem, type StructureHeading } from '../queries/useLearnerQueries.js';
import { useOcrStore } from '../stores/useOcrStore.js';
import { useCodexModelsQuery } from '../queries/useCodexQueries.js';
import { pickClassifyEffort } from '../utils/classify-effort.js';
import { sound } from '../utils/audio.js';
import { getPlatform } from '../platform/capabilities.js';
import type { TextbookBook, FuriganaWord } from '../models/textbook.js';
import { SAMPLE_TEXTBOOK_JSON } from '../fixtures/textbook-sample-ast.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Badge } from './ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select.js';

interface TextbookImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBook: (importedBook: TextbookBook, generatedCardsCount: number) => void;
  onAddCardsBatch: (cards: { front: string; back: string; category: string; prompt: string }[]) => void;
  /** 已有教材（接力追加用；无 documentId 的未入库书不列入） */
  existingBooks?: Array<{ documentId: string; title: string; lessons: number }>;
}

export function TextbookImporterModal({
  isOpen,
  onClose,
  onImportBook,
  onAddCardsBatch,
  existingBooks = [],
}: TextbookImporterModalProps) {
  const [inputText, setInputText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedAST, setParsedAST] = useState<TextbookAST | null>(null);
  const [autoGenerateCards, setAutoGenerateCards] = useState<boolean>(true);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPath, setPdfPath] = useState<string>('');
  const [pdfStartPage, setPdfStartPage] = useState<string>('');
  const [pdfEndPage, setPdfEndPage] = useState<string>('');
  const importPdf = useImportPdfMutation();
  const mapPdf = useMapPdfMutation();
  const classify = useClassifyStructureMutation();
  // 分类模型独立选择（与聊天模型偏好分开；默认取列表最末=最便宜可用）
  const { data: codexModels = [] } = useCodexModelsQuery(true);
  const [classifyModelId, setClassifyModelId] = useState<string>('');
  const effectiveClassifyModelId =
    classifyModelId || (codexModels.length > 0 ? (codexModels[codexModels.length - 1]?.model ?? '') : '');
  const [classifyResult, setClassifyResult] = useState<{
    classes: StructureClassItem[];
    dropped: number;
    model: string;
  } | null>(null);
  // 分类输入标题（与结果同源；确认入库时一并保存，供回来查看）
  const [classifyInputHeadings, setClassifyInputHeadings] = useState<StructureHeading[]>([]);
  const saveStructure = useSaveDocumentStructureMutation();
  const [classifyEffort, setClassifyEffort] = useState<string>('');
  const appendPdf = useAppendPdfMutation();
  const importDoc = useImportDocumentMutation();
  // Azure 云 OCR（失败页回填；只存本机，不填=纯本地链路）
  const azureDiEndpoint = useOcrStore((s) => s.azureDiEndpoint);
  const azureDiKey = useOcrStore((s) => s.azureDiKey);
  const setAzureDi = useOcrStore((s) => s.setAzureDi);
  const azureCreds =
    azureDiEndpoint.trim() && azureDiKey.trim()
      ? { endpoint: azureDiEndpoint.trim(), key: azureDiKey.trim() }
      : undefined;
  const [appendTarget, setAppendTarget] = useState<string>('');
  const [docPath, setDocPath] = useState<string>('');
  const [docUrl, setDocUrl] = useState<string>('');
  const [docNote, setDocNote] = useState<string | null>(null);

  // Dialog 以 open 控制可见性，无需提前 return
  // if (!isOpen) return null;


  const handleLoadSample = () => {
    sound.playClick();
    const formatted = JSON.stringify(SAMPLE_TEXTBOOK_JSON, null, 2);
    setInputText(formatted);
    setParseError(null);
    setParsedAST(SAMPLE_TEXTBOOK_JSON);
    toast.info('已载入《新编日语 第一册》结构化样例模版');
  };

  const handleDownloadTemplate = () => {
    sound.playClick();
    getPlatform()
      .downloadFile({
        filename: 'study-studio-textbook-template.json',
        content: JSON.stringify(SAMPLE_TEXTBOOK_JSON, null, 2),
        mimeType: 'application/json',
      })
      .then(() => toast.success('已下载教材 AST 模版文件'))
      .catch(() => toast.error('下载模版失败，请稍后重试'));
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setInputText(text);
    if (!text.trim()) {
      setParseError(null);
      setParsedAST(null);
      return;
    }

    try {
      const raw = JSON.parse(text);
      const res = parseTextbookAST(raw);
      if (res.ok) {
        setParseError(null);
        setParsedAST(res.value);
      } else {
        setParseError(res.error.userMessage);
        setParsedAST(null);
      }
    } catch {
      setParseError('JSON 语法错误，请检查括号与双引号格式');
      setParsedAST(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {    const file = e.target.files?.[0];
    if (!file) return;

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
          sound.playMistake();
        }
      } catch {
        setParseError('读取的文件并非标准 JSON 格式，请检查');
        setParsedAST(null);
        sound.playMistake();
      }
    };
    reader.readAsText(file);
  };

  const handlePdfFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // 选文件只暂存不自动导：大书先预览结构再定范围，小文件一点即导
    setPdfFile(file);
    setParseError(null);
    setPdfNote(`已选择 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB），可预览结构或直接导入`);
    sound.playClick();
  };

  const readPageRange = () => {
    const startPage = /^\d+$/.test(pdfStartPage.trim()) ? Number(pdfStartPage.trim()) : undefined;
    const endPage = /^\d+$/.test(pdfEndPage.trim()) ? Number(pdfEndPage.trim()) : undefined;
    return { startPage, endPage };
  };

  const handlePdfMap = () => {
    if (mapPdf.isPending) return;
    const path = pdfPath.trim();
    if (!pdfFile && !path) return;
    setParseError(null);
    sound.playClick();
    const { startPage, endPage } = readPageRange();
    const vars = pdfFile
      ? {
          file: pdfFile,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        }
      : {
          filePath: path,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        };
    mapPdf.mutate(vars,
      {
        onSuccess: (result) => {
          sound.playCorrect();
          if (result.headings.length === 0 && result.tocEntries.length === 0) {
            setPdfNote(`已扫 ${result.window.length} 页，未发现课标题/目录，换一段页码再试`);
          }
        },
        onError: (err) => {
          setParseError(err instanceof Error ? err.message : '结构预览失败');
          sound.playMistake();
        },
      }
    );
  };

  const handleClassifyHeadings = () => {
    if (classify.isPending) return;
    const headings = (mapPdf.data?.headings ?? [])
      .filter((h) => h.text.trim())
      .slice(0, 200)
      .map((h) => ({
        page: h.page,
        text: h.text,
        ...(h.relSize !== undefined ? { relSize: h.relSize } : {}),
        ...(h.bold !== undefined ? { bold: h.bold } : {}),
        ...(h.centered !== undefined ? { centered: h.centered } : {}),
        ...(h.standalone !== undefined ? { standalone: h.standalone } : {}),
        ...(h.hasNumbering !== undefined ? { hasNumbering: h.hasNumbering } : {}),
        ...(h.structRole !== undefined ? { structRole: h.structRole } : {}),
      }));
    if (headings.length === 0) {
      setParseError('先点结构预览扫出标题，再做 AI 分类');
      return;
    }
    setParseError(null);
    sound.playClick();
    const meta = codexModels.find((m) => m.model === effectiveClassifyModelId);
    const effort = pickClassifyEffort(meta?.supportedReasoningEfforts, meta?.defaultReasoningEffort);
    setClassifyEffort(effort ?? '');
    setClassifyInputHeadings(headings);
    classify.mutate(
      {
        headings,
        lang: 'ja',
        ...(effectiveClassifyModelId ? { model: effectiveClassifyModelId } : {}),
        ...(effort ? { effort } : {}),
      },
      {
        onSuccess: (r) => {
          setClassifyResult({ classes: r.classes, dropped: r.dropped, model: r.model });
          if (r.classes.length === 0) {
            // 空结果不是成功：模型没吐出可用条目（网关日志有 warn+debug），提示换模型/重试
            sound.playMistake();
            toast.warning('AI 分类空结果：模型没有返回可用判选（网关控制台有 warn 详情），换个模型或重试');
          } else {
            sound.playCorrect();
            toast.success(`AI 分类完成：${r.classes.length} 条已判，丢弃 ${r.dropped} 条（${r.model}）`);
          }
        },
        onError: (e) => {
          sound.playMistake();
          setParseError(e instanceof Error ? e.message : 'AI 分类失败');
        },
      }
    );
  };

  // EPUB/MOBI/URL 统一导入：后端只认本机路径/网址/文本，不收浏览器 File 上传
  const handleDocImport = () => {
    if (importDoc.isPending) return;
    const path = docPath.trim();
    const url = docUrl.trim();
    if (!path && !url) return;
    setParseError(null);
    setDocNote(null);
    sound.playClick();
    importDoc.mutate(path ? { filePath: path } : { url }, {
      onSuccess: (r) => {
        sound.playCorrect();
        setDocNote(`已导入《${r.title}》· ${r.lessons} 课，可在教材列表打开精读`);
        toast.success(`文档导入成功：${r.title}（${r.lessons} 课）`);
      },
      onError: (err) => {
        setParseError(err instanceof Error ? err.message : '文档导入失败');
        sound.playMistake();
      },
    });
  };

  const handlePdfImport = () => {    if (importPdf.isPending || appendPdf.isPending) return;
    const path = pdfPath.trim();
    if (!pdfFile && !path) return;
    setParseError(null);
    setPdfNote(null);
    sound.playClick();
    const { startPage, endPage } = readPageRange();
    // 接力模式：直接追加到已有书（网关合并+续排号），不走新书预览链路
    if (appendTarget) {
      const vars = pdfFile
        ? {
            documentId: appendTarget,
            file: pdfFile,
            ...(startPage !== undefined ? { startPage } : {}),
            ...(endPage !== undefined ? { endPage } : {}),
            ...(azureCreds ? { azure: azureCreds } : {}),
          }
        : {
            documentId: appendTarget,
            filePath: path,
            ...(startPage !== undefined ? { startPage } : {}),
            ...(endPage !== undefined ? { endPage } : {}),
            ...(azureCreds ? { azure: azureCreds } : {}),
          };
      appendPdf.mutate(vars, {
        onSuccess: (r) => {
          sound.playCorrect();
          toast.success(`接力成功：新增 ${r.addedLessons} 课 ${r.addedDialogues} 句，全书共 ${r.totalLessons} 课`);
          onClose();
        },
        onError: (err) => {
          setParseError(err instanceof Error ? err.message : '接力追加失败');
          sound.playMistake();
        },
      });
      return;
    }
    const vars = pdfFile
      ? {
          file: pdfFile,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        }
      : {
          filePath: path,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
        };
    importPdf.mutate(vars,
      {
      onSuccess: (result) => {
        setParsedAST(result.book);
        setInputText(JSON.stringify(result.book, null, 2));
        const c = result.classification;
        const kind =
          c.pdfType === 'TextBased' ? '文字版' : c.pdfType === 'Scanned' ? '扫描版（已 OCR）' : c.pdfType;
        const range =
          c.selectedPages.length > 0
            ? ` · 第 ${c.selectedPages[0]}–${c.selectedPages[c.selectedPages.length - 1]} 页`
            : '';
        setPdfNote(
          `识别为${kind} · ${c.pageCount} 页${range} · ${result.stats.lessons} 课 ${result.stats.dialogues} 句` +
            (c.ocrUsed ? ' · 首次 OCR 已按需下载运行时（约 80MB，一次性）' : '') +
            ((c.azurePages?.length ?? 0) > 0 ? ` · 云回填 ${c.azurePages?.length} 页` : '')
        );
        sound.playCorrect();
        toast.success(`PDF 解析成功：${result.stats.lessons} 课，${result.stats.dialogues} 句，确认后入库`);
      },
      onError: (err) => {
        setParseError(err instanceof Error ? err.message : 'PDF 导入失败');
        sound.playMistake();
      },
    });
  };

  const handleConfirmImport = () => {
    if (!parsedAST) return;

    sound.playCorrect();

    // 转化为客户端 TextbookBook 格式
    const convertedBook: TextbookBook = {
      id: parsedAST.id,
      language: parsedAST.language,
      title: parsedAST.title,
      shortTitle: parsedAST.shortTitle,
      publisher: parsedAST.publisher || '自定义导入',
      totalLessons: parsedAST.lessons.length,
      level: parsedAST.level,

      lessons: parsedAST.lessons.map((l) => ({
        id: l.id,
        bookId: parsedAST.id,
        lessonNumber: l.lessonNumber,
        title: l.title,
        subTitle: l.summary || l.title,
        targetLevel: parsedAST.level,
        scene: '课文解析与句型操练',
        associatedQuizTag: `custom.${parsedAST.id}.${l.id}`,
        dialogues: l.dialogues.map((d, idx) => ({
          id: `dlg-${l.id}-${idx}`,
          speaker: d.speaker,
          japanese: d.japanese,
          chinese: d.chinese,
          furiganaTokens: d.words
            ? d.words.map((w) => {
                const item: FuriganaWord = { surface: w.surface };
                if (w.reading) item.reading = w.reading;
                if (w.meaning) item.meaning = w.meaning;
                if (w.pos) item.pos = w.pos;
                return item;
              })
            : [{ surface: d.japanese }],
        })),
        vocabularies: l.vocabularies.map((v) => ({

          id: v.id,
          kanji: v.kanji,
          kana: v.kana,
          romaji: v.romaji || '',
          chinese: v.chinese,
          pos: v.pos,
          pitchAccent: v.pitchAccent,
          pitchType: v.pitchAccent.includes('⓪')
            ? '平板型'
            : v.pitchAccent.includes('①')
              ? '头高型'
              : '中高型',
          exampleSentence: v.example?.japanese || '',
          exampleTranslation: v.example?.chinese || '',
        })),
        grammarPoints: l.grammarPoints.map((g) => ({
          id: g.id,
          title: g.title,
          structure: g.connection,
          explanation: g.explanation,
          examples: g.examples.map((ex) => ({
            ja: ex.japanese,
            zh: ex.chinese,
          })),
        })),
      })),
    };

    // 提取全部生词并按需转为 FSRS 卡片
    let totalCardsCount = 0;
    if (autoGenerateCards) {
      const generatedCards: { front: string; back: string; category: string; prompt: string }[] = [];
      for (const lesson of parsedAST.lessons) {
        for (const vocab of lesson.vocabularies) {
          generatedCards.push({
            front: `${vocab.kanji} (${vocab.kana})`,
            back: `${vocab.chinese} [${vocab.pos} · ${vocab.pitchAccent}]`,
            category: 'VOCAB',
            prompt: `来自《${parsedAST.shortTitle}》${lesson.title}`,
          });
        }
      }
      if (generatedCards.length > 0) {
        onAddCardsBatch(generatedCards);
        totalCardsCount = generatedCards.length;
      }
    }

    onImportBook(convertedBook, totalCardsCount);
    // 分类结果随确认入库（观测存档：回来可查当时判了什么、用的哪个模型）
    if (classifyResult && classifyResult.classes.length > 0) {
      saveStructure.mutate({
        documentId: convertedBook.id,
        headings: classifyInputHeadings,
        classes: classifyResult.classes,
        model: classifyResult.model,
        effort: classifyEffort,
        dropped: classifyResult.dropped,
      });
    }
    toast.success(
      `成功导入《${convertedBook.title}》！已收录 ${convertedBook.lessons.length} 课，${totalCardsCount > 0 ? `生成 ${totalCardsCount} 张 FSRS 记忆卡片` : ''}`
    );
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0"
        showCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b border-amber-900/10 dark:border-amber-500/15 bg-amber-500/5 text-left">
          <div className="flex items-center gap-2.5 pr-8">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                结构化教材导入与解析管道
                <Badge variant="amber" className="text-[10px] font-mono">
                  Textbook AST v1.0
                </Badge>
              </DialogTitle>
              <DialogDescription>
                支持严格类型安全的课次知识树，杜绝纯切片检索造成的教学结构破坏
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-amber-500/5 border border-amber-900/10 dark:border-amber-500/10">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition-colors">
                <Upload className="w-3.5 h-3.5" />
                上传教材 JSON 文件
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
              <Button variant="secondary" size="sm" onClick={handleLoadSample}>
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                载入官方样例《新编日语》
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
              <Download className="w-3.5 h-3.5" />
              下载 AST 规范模版
            </Button>
          </div>

          <div className="p-3 rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition-colors">
                <FileUp className="w-3.5 h-3.5" />
                {pdfFile ? '换一份 PDF' : '选择 PDF 教材（自有资料）'}
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  disabled={importPdf.isPending || mapPdf.isPending}
                  onChange={handlePdfFile}
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                disabled={(!pdfFile && !pdfPath.trim()) || importPdf.isPending || mapPdf.isPending}
                onClick={handlePdfMap}
                title="先扫目录/标题，再定页码范围"
              >
                {mapPdf.isPending ? '扫目录中…' : '预览结构'}
              </Button>
              <Button
                size="sm"
                disabled={(!pdfFile && !pdfPath.trim()) || importPdf.isPending || mapPdf.isPending || appendPdf.isPending}
                onClick={handlePdfImport}
              >
                {importPdf.isPending || appendPdf.isPending
                  ? 'PDF 解析中…'
                  : appendTarget
                    ? '追加到该书（接力）'
                    : '开始导入'}
              </Button>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                文字版直接提取；扫描版自动 OCR（首次约 80MB 按需下载，不进安装包）· 扫描版韩语暂不支持
                {azureCreds ? ' · 云回填已启用（只打本地失败页）' : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span title="大书分段导：先导一段成书，后续段选这本书接力追加，别重复导同一段">
                接力到已有书（选填，不选则成新书）：
              </span>
              <Select
                value={appendTarget || '__new'}
                onValueChange={(v) => setAppendTarget(!v || v === '__new' ? '' : v)}
              >
                <SelectTrigger className="w-56 h-7 text-[11px]">
                  <SelectValue placeholder="作为新书导入" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new">作为新书导入</SelectItem>
                  {existingBooks.map((b) => (
                    <SelectItem key={b.documentId} value={b.documentId}>
                      {b.title}（{b.lessons} 课）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span>大书按课分段导（选填，1-based 页码）：</span>
              <input
                type="number"
                min={1}
                placeholder="起始页"
                value={pdfStartPage}
                onChange={(e) => setPdfStartPage(e.target.value)}
                disabled={importPdf.isPending}
                className="w-20 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500"
              />
              <span>–</span>
              <input
                type="number"
                min={1}
                placeholder="结束页"
                value={pdfEndPage}
                onChange={(e) => setPdfEndPage(e.target.value)}
                disabled={importPdf.isPending}
                className="w-20 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span title="百 MB 大书走上传会崩网关；同机网关可直接填本机绝对路径直读（桌面端选文件即路径）">
                大文件本地直读（选填，本机绝对路径）：
              </span>
              <input
                type="text"
                placeholder="例如 C:\Books\minna.pdf（留空则用上方已选文件上传）"
                value={pdfPath}
                onChange={(e) => {
                  setPdfPath(e.target.value);
                  if (e.target.value.trim()) setPdfFile(null);
                }}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span title="只打本地 OCR 失败的页（<50 字），平时零花费；Key 只存本机，随请求发网关，网关不落盘">
                Azure 云回填（选填，难啃扫描页用）：
              </span>
              <input
                type="text"
                placeholder="endpoint（https://xxx.cognitiveservices.azure.com）"
                value={azureDiEndpoint}
                onChange={(e) => setAzureDi(e.target.value, azureDiKey)}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500 font-mono"
              />
              <input
                type="password"
                placeholder="Key"
                value={azureDiKey}
                onChange={(e) => setAzureDi(azureDiEndpoint, e.target.value)}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="w-36 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-amber-500 font-mono"
              />
            </div>
            {pdfNote && (
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{pdfNote}</p>
            )}
            {(mapPdf.data?.tocEntries.length ?? 0) > 0 && (
              <div className="text-[11px] text-stone-600 dark:text-stone-300 space-y-1">
                <p className="font-bold">目录（点条目按印刷页码定位，仅供参考）：</p>
                <div className="flex flex-wrap gap-1.5">
                  {mapPdf.data?.tocEntries.slice(0, 30).map((t) => (
                    <span
                      key={`${t.lessonNo}@${t.printedPage}`}
                      className="px-2 py-0.5 rounded-lg border border-stone-200 dark:border-stone-700"
                      title={t.label}
                    >
                      第{t.lessonNo}課 · p{t.printedPage}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(mapPdf.data?.headings.length ?? 0) > 0 && (
              <div className="text-[11px] text-stone-600 dark:text-stone-300 space-y-1">
                <p className="font-bold">标题（点一行自动填入起始页）：</p>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {mapPdf.data?.headings.slice(0, 60).map((h, i) => (
                    <button
                      key={`${h.page}-${i}`}
                      type="button"
                      onClick={() => {
                        setPdfStartPage(String(h.page));
                        setPdfEndPage(String(h.page + 14));
                        sound.playClick();
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-amber-500/10 text-left cursor-pointer"
                      title={`从第 ${h.page} 页开始导（默认连导 15 页，可改）`}
                    >
                      <span className="truncate">
                        {h.text}
                        {(h.bold === true ||
                          h.centered === true ||
                          h.standalone === true ||
                          h.hasNumbering === true ||
                          h.structRole ||
                          h.relSize !== undefined) && (
                          <span
                            className="ml-1.5 text-stone-400"
                            title={[
                              h.relSize !== undefined ? `字号约正文 ${h.relSize} 倍` : '',
                              h.bold === true ? '加粗' : '',
                              h.centered === true ? '居中' : '',
                              h.standalone === true ? '独立行' : '',
                              h.hasNumbering === true ? '带编号' : '',
                              h.structRole ? `标签:${h.structRole}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                          ◈
                        </span>
                      )}</span>
                      <span className="shrink-0 font-mono text-stone-400">p{h.page}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="font-bold">分类模型：</span>
                  <Select
                    value={effectiveClassifyModelId}
                    onValueChange={(v: string | null) => {
                      sound.playClick();
                      setClassifyModelId(v ?? '');
                      setClassifyResult(null);
                    }}
                    disabled={codexModels.length === 0}
                  >
                    <SelectTrigger className="h-7 min-w-44 text-[11px]">
                      <SelectValue
                        placeholder={codexModels.length === 0 ? '无可用模型（用网关默认）' : '选择分类模型'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {codexModels.map((m) => (
                        <SelectItem key={m.id} value={m.model} className="text-[11px]">
                          {m.displayName || m.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px] gap-1.5"
                    disabled={classify.isPending}
                    onClick={handleClassifyHeadings}
                    title="小模型判选：课/节/目录/噪音 + 能力板块（临时会话，跑完即焚；默认取列表最末模型）"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>{classify.isPending ? '分类中…' : 'AI 分类'}</span>
                  </Button>
                </div>
                {classifyResult && (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-2 space-y-1.5">
                    <p className="font-bold text-stone-700 dark:text-stone-200">
                      分类结果（{classifyResult.model}）：{classifyResult.classes.length} 条已判
                      {classifyResult.dropped > 0 && `，丢弃 ${classifyResult.dropped} 条（对不上原文/非法）`}
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {classifyResult.classes.map((c, i) => (
                        <div
                          key={`${c.page}-${i}`}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white/60 dark:bg-stone-900/40"
                        >
                          <span className="truncate">
                            {c.text}
                            <span className="ml-1 font-mono text-stone-400">p{c.page}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {c.kind === 'lesson'
                                ? `课${c.lessonNo ? ` · ${c.lessonNo}` : ''}`
                                : c.kind === 'section'
                                  ? '节'
                                  : c.kind === 'toc'
                                    ? '目录'
                                    : '噪音'}
                            </Badge>
                            {c.skillId && (
                              <Badge variant="amber" className="text-[10px] font-mono">
                                {c.skillId}
                              </Badge>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-3 rounded-2xl border border-dashed border-sky-500/40 bg-sky-500/5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-stone-700 dark:text-stone-300">
                EPUB / MOBI / 网页导入：
              </span>
              <input
                type="text"
                placeholder="本机绝对路径，例如 C:\Books\xxx.epub（MOBI 仅未压缩 DRM-free）"
                value={docPath}
                onChange={(e) => {
                  setDocPath(e.target.value);
                  if (e.target.value.trim()) setDocUrl('');
                }}
                disabled={importDoc.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-sky-500 font-mono text-[11px]"
              />
              <input
                type="text"
                placeholder="或粘贴网址（https://…）"
                value={docUrl}
                onChange={(e) => {
                  setDocUrl(e.target.value);
                  if (e.target.value.trim()) setDocPath('');
                }}
                disabled={importDoc.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 outline-none focus:border-sky-500 font-mono text-[11px]"
              />
              <Button
                size="sm"
                disabled={(!docPath.trim() && !docUrl.trim()) || importDoc.isPending}
                onClick={handleDocImport}
              >
                {importDoc.isPending ? '导入中…' : '开始导入'}
              </Button>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              目录驱动成课（EPUB 按 NCX/nav+spine 定位）；浏览器无本地路径时请用桌面端或网址
            </p>
            {docNote && (
              <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">{docNote}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-stone-700 dark:text-stone-300 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-amber-500" />
                教材 AST JSON 数据
              </label>
              {parsedAST && (
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  验证通过: 《{parsedAST.shortTitle}》 共 {parsedAST.lessons.length} 课
                </span>
              )}
            </div>
            <textarea
              value={inputText}
              onChange={handleTextChange}
              placeholder="请在此粘贴符合规范的 Textbook AST JSON，或点击上方载入官方样例..."
              rows={10}
              className="w-full p-3 font-mono text-xs rounded-2xl bg-white dark:bg-[#151412] border border-stone-200 dark:border-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500/40 text-stone-800 dark:text-stone-200 leading-relaxed resize-none shadow-inner"
            />
          </div>

          {parseError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-rose-700 dark:text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{parseError}</span>
            </div>
          )}

          {parsedAST && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-900/10 dark:border-amber-500/20 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  自动为全课生词生成 FSRS 记忆卡片
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  将提取{' '}
                  {parsedAST.lessons.reduce((acc, l) => acc + l.vocabularies.length, 0)}{' '}
                  个生词直接注入今日复习池
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoGenerateCards}
                onChange={(e) => setAutoGenerateCards(e.target.checked)}
                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-stone-300"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-amber-900/10 dark:border-amber-500/15 bg-amber-500/5">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!parsedAST} onClick={handleConfirmImport}>
            确认导入并激活
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
