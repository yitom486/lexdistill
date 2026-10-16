import { LoaderCircle, TriangleAlert } from 'lucide-react';

interface AnkiTemplatePreviewProps {
  sampleHeadword: string;
  previewPending: boolean;
  previewDoc: string;
  issues: string[];
  previewError: string | null;
}

/**
 * 模板实时预览列（纯展示）：渲染中、沙箱预览、模板问题、预览失败。
 * 预览数据由容器经网关渲染得到；模板脚本永不执行（sandbox iframe）。
 */
export function AnkiTemplatePreview(props: AnkiTemplatePreviewProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-faint">
        实时预览（示例词：{props.sampleHeadword}；模板脚本永不执行）
      </p>
      {props.previewPending && (
        <p className="flex items-center gap-1.5 text-xs text-ink-stone-400">
          <LoaderCircle className="h-3 w-3 animate-spin" /> 渲染中…
        </p>
      )}
      {props.previewDoc && (
        <iframe
          title="卡片预览"
          sandbox=""
          srcDoc={props.previewDoc}
          className="h-72 w-full rounded-xl border border-ink-stone-200 bg-tone-white dark:border-tone-stone-700 transition-colors"
        />
      )}
      {props.issues.length > 0 && (
        <div className="rounded-xl border border-tone-amber-500o40 bg-wash-amber-500o5 p-2 text-xs text-accent-ink-strong">
          {props.issues.map((issue) => (
            <p key={issue} className="flex items-start gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>{issue}</span>
            </p>
          ))}
        </div>
      )}
      {props.previewError && (
        <p className="text-xs text-ink-rose-600">
          {props.previewError}
        </p>
      )}
    </div>
  );
}
