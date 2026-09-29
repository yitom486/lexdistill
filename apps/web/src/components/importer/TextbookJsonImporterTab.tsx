import React from 'react';
import { Upload, Download, FileText, CheckCircle2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { parseTextbookAST, type TextbookAST } from '@study-studio/document-model';
import { SAMPLE_TEXTBOOK_JSON } from '../../fixtures/textbook-sample-ast.js';
import { getPlatform } from '../../platform/capabilities.js';
import { sound } from '../../utils/audio.js';
import { Button } from '../ui/button.js';

interface TextbookJsonImporterTabProps {
  inputText: string;
  setInputText: (text: string) => void;
  parsedAST: TextbookAST | null;
  setParsedAST: (ast: TextbookAST | null) => void;
  setParseError: (err: string | null) => void;
}

export function TextbookJsonImporterTab({
  inputText,
  setInputText,
  parsedAST,
  setParsedAST,
  setParseError,
}: TextbookJsonImporterTabProps) {
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-wash-amber-500o5 border border-line-soft">
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
    </div>
  );
}
