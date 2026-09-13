import React, { useRef, useState } from 'react';
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
import { nextRelayWindow, resolveOcrOverflowWindow, resolvePdfPageRange } from '../lib/pdf-page-range.js';
import { isPdfUploadTooLarge, pdfTooLargeMessage, stripPdfPathQuotes } from '../lib/pdf-upload-guard.js';
import { GatewayRequestError } from '../lib/gateway-error.js';
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
  /** CMD-09：超大文件被拒的 PDF 区内联错误（底部 parseError 之外，选中即见） */
  const [pdfFileError, setPdfFileError] = useState<string | null>(null);
  const pdfPathInputRef = useRef<HTMLInputElement>(null);
  const [pdfStartPage, setPdfStartPage] = useState<string>('');
  const [pdfEndPage, setPdfEndPage] = useState<string>('');
  /** 全部页 = 不传 start/end；指定页码必须填齐两端 */
  const [pdfScope, setPdfScope] = useState<'all' | 'range'>('all');
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
    // CMD-09：≥32MB 的 File 不收（multipart 会撑网关）：立刻 toast + PDF 区内联错误
    //（单源文案），focus 路径框引导手填直读；仍不保留 File、不上传。
    if (isPdfUploadTooLarge(file.size)) {
      const msg = pdfTooLargeMessage(file.name, file.size);
      setPdfFile(null);
      setPdfNote(null);
      setParseError(msg);
      setPdfFileError(msg);
      toast.error(msg);
      sound.playMistake();
      pdfPathInputRef.current?.focus();
      return;
    }
    // 选文件只暂存不自动导：大书先预览结构再定范围，小文件一点即导
    setPdfFile(file);
    setPdfFileError(null);
    setParseError(null);
    setPdfNote(`已选择 ${file.name}（${(file.size / 1024 / 1024).toFixed(1)}MB），可预览结构或直接导入`);
    sound.playClick();
  };

  const readPageRange = () => resolvePdfPageRange(pdfScope, pdfStartPage, pdfEndPage);

  const handlePdfMap = () => {
    if (mapPdf.isPending) return;
    // CMD-10：截图路径常带一对引号，发送前剥掉。
    const path = stripPdfPathQuotes(pdfPath);
    // D：超大 File 视为无文件（有路径走直读，无路径报错引导，不上传）。
    const mapFile = pdfFile && !isPdfUploadTooLarge(pdfFile.size) ? pdfFile : null;
    if (!mapFile && !path) {
      if (pdfFile) {
        const msg = pdfTooLargeMessage(pdfFile.name, pdfFile.size);
        setParseError(msg);
        setPdfFileError(msg);
      }
      return;
    }
    setParseError(null);
    const range = readPageRange();
    if (range === 'incomplete-range') {
      setParseError('已选「指定页码」，请同时填写起始页和结束页');
      return;
    }
    sound.playClick();
    const { startPage, endPage } = range;
    const vars = mapFile
      ? {
          file: mapFile,
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
          const headingPreview = result.headings
            .slice(0, 12)
            .map((h) => `p${h.page} ${h.text}`)
            .join(' · ');
          setPdfNote(
            `结构预览：全书 ${result.classification.pageCount} 页 · 本窗 ${result.window.length} 页` +
              (result.classification.ocrUsed ? ' · 已 OCR' : '') +
              ` · 标题 ${result.headings.length} 条 · 目录 ${result.tocEntries.length} 条` +
              (headingPreview ? ` → ${headingPreview}` : ' · 未发现课标题/目录，换一段页码再试')
          );
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
    // CMD-10：截图路径常带一对引号，发送前剥掉。
    const path = stripPdfPathQuotes(pdfPath);
    // D：超大 File 视为无文件（有路径走直读，无路径报错引导，不上传）。
    const importFile = pdfFile && !isPdfUploadTooLarge(pdfFile.size) ? pdfFile : null;
    if (!importFile && !path) {
      if (pdfFile) {
        const msg = pdfTooLargeMessage(pdfFile.name, pdfFile.size);
        setParseError(msg);
        setPdfFileError(msg);
      }
      return;
    }
    setParseError(null);
    setPdfNote(null);
    const range = readPageRange();
    if (range === 'incomplete-range') {
      setParseError('已选「指定页码」，请同时填写起始页和结束页');
      return;
    }
    sound.playClick();
    const { startPage, endPage } = range;
    // 接力模式：直接追加到已有书（网关合并+续排号），不走新书预览链路
    if (appendTarget) {
      const vars = importFile
        ? {
            documentId: appendTarget,
            file: importFile,
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
    const vars = importFile
      ? {
          file: importFile,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
          // CMD-01：已跑过 AI 分类且结果非空时，把同一批 classes 交给 convert 切课
          //（观测仍在确认后经 saveStructure 存档，此处只决定课边界）。
          ...(classifyResult && classifyResult.classes.length > 0
            ? { classes: classifyResult.classes }
            : {}),
        }
      : {
          filePath: path,
          ...(startPage !== undefined ? { startPage } : {}),
          ...(endPage !== undefined ? { endPage } : {}),
          ...(azureCreds ? { azure: azureCreds } : {}),
          ...(classifyResult && classifyResult.classes.length > 0
            ? { classes: classifyResult.classes }
            : {}),
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
        const titles = result.book.lessons.map((l) => l.title);
        // CMD-08：下一接力窗（书未导完时预填，不发请求，不改接力目标）。
        const next = nextRelayWindow(c.selectedPages, c.pageCount);
        if (c.clampedFromAll === true) {
          const first = c.selectedPages[0] ?? 1;
          const last = c.selectedPages[c.selectedPages.length - 1] ?? first;
          if (next) {
            setPdfScope('range');
            setPdfStartPage(String(next.startPage));
            setPdfEndPage(String(next.endPage));
          }
          setPdfNote(
            `扫描书一次最多 30 页，已导入第 ${first}–${last} 页 · ${result.stats.lessons} 课 ${result.stats.dialogues} 句` +
              (titles.length > 0 ? ` → ${titles.join(' / ')}` : '') +
              (next
                ? `；已预填第 ${next.startPage}–${next.endPage} 页，选「接力到已有书」继续`
                : '；剩余请指定页码并选「接力到已有书」')
          );
          sound.playCorrect();
          toast.success(
            `扫描书一次最多 30 页，已导入第 ${first}–${last} 页` +
              (next ? `，已预填第 ${next.startPage}–${next.endPage} 页待接力` : '，请指定页码接力')
          );
          return;
        }
        setPdfNote(
          `识别为${kind} · ${c.pageCount} 页${range} · ${result.stats.lessons} 课 ${result.stats.dialogues} 句` +
            (c.ocrUsed ? ' · 已 OCR' : '') +
            ((c.azurePages?.length ?? 0) > 0 ? ` · 云回填 ${c.azurePages?.length} 页` : '') +
            (titles.length > 0 ? ` → ${titles.join(' / ')}` : '')
        );
        sound.playCorrect();
        toast.success(`PDF 解析成功：${result.stats.lessons} 课（${titles.slice(0, 8).join('、')}${titles.length > 8 ? '…' : ''}），确认后入库`);
        if (next && c.selectedPages.length > 0) {
          // 自选范围成功且书未完：预填下一窗方便接力。
          setPdfStartPage(String(next.startPage));
          setPdfEndPage(String(next.endPage));
        }
      },
      onError: (err) => {
        // A：err.message 即网关 userMessage，直接展示。
        // C：全部页扫描超限→切「指定页码」填首个 30 页窗（有标题从首条标题页起），不自动重试。
        setParseError(err instanceof Error ? err.message : 'PDF 导入失败');
        sound.playMistake();
        if (pdfScope === 'all' && err instanceof GatewayRequestError) {
          const suggestion = resolveOcrOverflowWindow(
            err.details,
            mapPdf.data?.headings,
            mapPdf.data?.classification.pageCount
          );
          if (suggestion) {
            setPdfScope('range');
            setPdfStartPage(String(suggestion.startPage));
            setPdfEndPage(String(suggestion.endPage));
          }
        }
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
        <DialogHeader className="px-6 py-4 border-b border-line-accent bg-wash-amber-500o5 text-left">
          <div className="flex items-center gap-2.5 pr-8">
            <div className="p-2 rounded-xl bg-wash-amber-500o15 text-ink-amber-800-amber-400">
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
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-wash-amber-500o5 border border-line-amber-900o10-amber-500o10">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs font-semibold shadow-xs transition-colors">
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
                <Sparkles className="w-3.5 h-3.5 text-tone-amber-500" />
                载入官方样例《新编日语》
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={handleDownloadTemplate}>
              <Download className="w-3.5 h-3.5" />
              下载 AST 规范模版
            </Button>
          </div>

          <div className="p-3 rounded-2xl border border-dashed border-tone-amber-500o40 bg-wash-amber-500o5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white text-xs font-semibold shadow-xs transition-colors">
                <FileUp className="w-3.5 h-3.5" />
                {pdfFile ? '换一份 PDF' : '选择 PDF（<32MB 小文件）'}
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
              <span className="text-[11px] text-ink-ghost">
                文字版直接提取；扫描版自动 OCR（首次约 80MB 按需下载，不进安装包）· 扫描版韩语暂不支持
                {azureCreds ? ' · 云回填已启用（只打本地失败页）' : ''}
              </span>
            </div>
            {pdfFileError && (
              <p role="alert" className="text-[11px] font-semibold text-ink-red-600-red-400">
                {pdfFileError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-ghost">
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
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-ghost">
              <span>导入范围：</span>
              <button
                type="button"
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold ${
                  pdfScope === 'all'
                    ? 'border-tone-amber-600 bg-tone-amber-600 text-tone-white'
                    : 'border-line'
                }`}
                disabled={importPdf.isPending || mapPdf.isPending}
                onClick={() => {
                  setPdfScope('all');
                  setPdfStartPage('');
                  setPdfEndPage('');
                }}
              >
                全部页
              </button>
              <button
                type="button"
                className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold ${
                  pdfScope === 'range'
                    ? 'border-tone-amber-600 bg-tone-amber-600 text-tone-white'
                    : 'border-line'
                }`}
                disabled={importPdf.isPending || mapPdf.isPending}
                onClick={() => setPdfScope('range')}
              >
                指定页码
              </button>
              {pdfScope === 'range' && (
                <>
                  <input
                    type="number"
                    min={1}
                    placeholder="起始页"
                    value={pdfStartPage}
                    onChange={(e) => setPdfStartPage(e.target.value)}
                    disabled={importPdf.isPending}
                    className="w-20 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500"
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="结束页"
                    value={pdfEndPage}
                    onChange={(e) => setPdfEndPage(e.target.value)}
                    disabled={importPdf.isPending}
                    className="w-20 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500"
                  />
                </>
              )}
              <span className="text-ink-stone-400">
                {pdfScope === 'all'
                  ? '扫描书单次 OCR 最多 30 页，「全部页」只导前 30 页并提示接力；要指定位置请用指定页码'
                  : '1-based 页码，含两端；点下方标题可自动填一段'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-ghost">
              <span
                className="font-bold text-ink-mute-deep"
                title="百 MB 大书走上传会崩网关；同机网关直接填本机绝对路径走 filePath 直读，上限 500MB"
              >
                本机绝对路径直读（大/扫描教材主入口）：
              </span>
              <input
                ref={pdfPathInputRef}
                type="text"
                placeholder="贴完整绝对路径（含盘符，以 .pdf 结尾）；有路径可直接预览/导入"
                value={pdfPath}
                onChange={(e) => {
                  setPdfPath(e.target.value);
                  if (e.target.value.trim()) {
                    setPdfFile(null);
                    setPdfFileError(null);
                  }
                }}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500 font-mono"
              />
              <span className="text-ink-stone-400">
                扫描/大教材请把完整绝对路径贴到这里（含盘符与 .pdf）；「选择 PDF」仅用于几十页以内、小于 32MB 的小文件
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-ghost">
              <span title="只打本地 OCR 失败的页（<50 字），平时零花费；Key 只存本机，随请求发网关，网关不落盘">
                Azure 云回填（选填，难啃扫描页用）：
              </span>
              <input
                type="text"
                placeholder="endpoint（https://xxx.cognitiveservices.azure.com）"
                value={azureDiEndpoint}
                onChange={(e) => setAzureDi(e.target.value, azureDiKey)}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500 font-mono"
              />
              <input
                type="password"
                placeholder="Key"
                value={azureDiKey}
                onChange={(e) => setAzureDi(azureDiEndpoint, e.target.value)}
                disabled={importPdf.isPending || mapPdf.isPending}
                className="w-36 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tone-amber-500 font-mono"
              />
            </div>
            {pdfNote && (
              <p className="text-[11px] font-semibold text-ink-emerald-700-emerald-400">{pdfNote}</p>
            )}
            {(mapPdf.data?.tocEntries.length ?? 0) > 0 && (
              <div className="text-[11px] text-ink-faint space-y-1">
                <p className="font-bold">目录（点条目按印刷页码定位，仅供参考）：</p>
                <div className="flex flex-wrap gap-1.5">
                  {mapPdf.data?.tocEntries.slice(0, 30).map((t) => (
                    <span
                      key={`${t.lessonNo}@${t.printedPage}`}
                      className="px-2 py-0.5 rounded-lg border border-line"
                      title={t.label}
                    >
                      第{t.lessonNo}課 · p{t.printedPage}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(mapPdf.data?.headings.length ?? 0) > 0 && (
              <div className="text-[11px] text-ink-faint space-y-1">
                <p className="font-bold">标题（点一行自动填入起始页）：</p>
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {mapPdf.data?.headings.slice(0, 60).map((h, i) => (
                    <button
                      key={`${h.page}-${i}`}
                      type="button"
                      onClick={() => {
                        setPdfScope('range');
                        setPdfStartPage(String(h.page));
                        setPdfEndPage(String(h.page + 14));
                        sound.playClick();
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-wash-amber-500o10 text-left cursor-pointer"
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
                            className="ml-1.5 text-ink-stone-400"
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
                      <span className="shrink-0 font-mono text-ink-stone-400">p{h.page}</span>
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
                    <Sparkles className="w-3.5 h-3.5 text-tone-amber-500" />
                    <span>{classify.isPending ? '分类中…' : 'AI 分类'}</span>
                  </Button>
                </div>
                {classifyResult && (
                  <div className="rounded-xl border border-tone-amber-500o25 bg-wash-amber-500o5 p-2 space-y-1.5">
                    <p className="font-bold text-ink-mute-deep">
                      分类结果（{classifyResult.model}）：{classifyResult.classes.length} 条已判
                      {classifyResult.dropped > 0 && `，丢弃 ${classifyResult.dropped} 条（对不上原文/非法）`}
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {classifyResult.classes.map((c, i) => (
                        <div
                          key={`${c.page}-${i}`}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-veil-whiteo60-stone-900o40"
                        >
                          <span className="truncate">
                            {c.text}
                            <span className="ml-1 font-mono text-ink-stone-400">p{c.page}</span>
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
            <div className="pt-1 mt-1 border-t border-tone-amber-500o20 space-y-1.5">
              <p className="text-[11px] font-bold text-ink-mute-deep">
                目录识别与人工确认（只读，不入库；用上方已选 PDF / 路径）
              </p>
              <p className="text-[11px] text-ink-ghost">目录识别流程已下线重构，本区域暂不可用。</p>
            </div>
          </div>

          <div className="p-3 rounded-2xl border border-dashed border-tone-sky-500o40 bg-wash-sky-500o5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-ink-mute">
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
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tint-sky-500 font-mono text-[11px]"
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
                className="flex-1 min-w-52 h-7 px-2 rounded-lg border border-line bg-surface text-ink outline-none focus:border-tint-sky-500 font-mono text-[11px]"
              />
              <Button
                size="sm"
                disabled={(!docPath.trim() && !docUrl.trim()) || importDoc.isPending}
                onClick={handleDocImport}
              >
                {importDoc.isPending ? '导入中…' : '开始导入'}
              </Button>
            </div>
            <p className="text-[11px] text-ink-ghost">
              目录驱动成课（EPUB 按 NCX/nav+spine 定位）；浏览器无本地路径时请用桌面端或网址
            </p>
            {docNote && (
              <p className="text-[11px] font-semibold text-ink-emerald-700-emerald-400">{docNote}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-ink-mute flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-tone-amber-500" />
                教材 AST JSON 数据
              </label>
              {parsedAST && (
                <span className="text-xs font-semibold text-ink-emerald-700-emerald-400 flex items-center gap-1">
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
              className="w-full p-3 font-mono text-xs rounded-2xl bg-surface-ash border border-line-soft focus:outline-none focus:ring-2 focus:ring-tone-amber-500o40 text-ink-soft leading-relaxed resize-none shadow-inner"
            />
          </div>

          {parseError && (
            <div className="p-3 rounded-xl bg-wash-rose-500o10 border border-line-rose-500o20 flex items-start gap-2 text-ink-rose-700-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="leading-relaxed">{parseError}</span>
            </div>
          )}

          {parsedAST && (
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
              <input
                type="checkbox"
                checked={autoGenerateCards}
                onChange={(e) => setAutoGenerateCards(e.target.checked)}
                className="w-4 h-4 rounded text-tone-amber-600 focus:ring-tone-amber-500 border-tone-stone-300"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-line-accent bg-wash-amber-500o5">
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
