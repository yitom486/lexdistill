/**
 * 受限 Markdown 渲染（react-markdown + remark-gfm，无 rehype，不过滤之外不执行 HTML）。
 * - 加粗 / 列表 / `[文案](链接)` / 裸 URL 自动链接；
 * - 链接统一走平台外链口（Tauri 下不会开空白页）；
 * - 先给 AI 导师气泡用，AgentChat 接入前需复查系统文案在 md 下的观感。
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getPlatform } from '../../platform/capabilities.js';

function linkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const href = e.currentTarget.getAttribute('href');
  if (!href) return;
  e.preventDefault();
  void getPlatform().openExternalUrl(href);
}

/**
 * @param surface
 * - 'adaptive'（默认）：跟随应用明暗主题（导师抽屉等浅色底面板）。
 * - 'dark'：强制深色底浅色字（Agent 对话面板恒为深色，不依赖 html.dark）。
 */
export function MarkdownText({ text, surface = 'adaptive' }: { text: string; surface?: 'adaptive' | 'dark' }) {
  const dark = surface === 'dark';
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={linkClick}
        className="text-accent-ink-strong underline decoration-tone-amber-500o50 underline-offset-2 break-all cursor-pointer"
      >
        {children}
      </a>
    ),
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => (
      <strong className={dark ? 'font-bold text-tone-stone-100' : 'font-bold text-ink'}>
        {children}
      </strong>
    ),
    code: ({ children }) => (
      <code
        className={
          dark
            ? 'rounded bg-tone-stone-800 px-1 py-0.5 font-mono text-[0.95em]'
            : 'rounded bg-veil-stone-200o70-stone-800 px-1 py-0.5 font-mono text-[0.95em]'
        }
      >
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre
        className={
          dark
            ? 'my-2 overflow-x-auto rounded-xl bg-tone-stone-950 p-2.5 text-[0.95em]'
            : 'my-2 overflow-x-auto rounded-xl bg-surface-stone-100-stone-950 p-2.5 text-[0.95em]'
        }
      >
        {children}
      </pre>
    ),
    h1: ({ children }) => <div className="mt-2 mb-1 font-bold">{children}</div>,
    h2: ({ children }) => <div className="mt-2 mb-1 font-bold">{children}</div>,
    h3: ({ children }) => <div className="mt-2 mb-1 font-bold">{children}</div>,
    h4: ({ children }) => <div className="mt-2 mb-1 font-bold">{children}</div>,
    blockquote: ({ children }) => (
      <div
        className={
          dark
            ? 'border-l-2 border-tone-amber-500o40 pl-2 text-tone-stone-300'
            : 'border-l-2 border-tone-amber-500o40 pl-2 text-ink-faint'
        }
      >
        {children}
      </div>
    ),
  };
  return (
    <div className="markdown-body text-xs sm:text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
