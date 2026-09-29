import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, Home, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import { toast } from 'sonner';
import { getPlatform } from '../../platform/capabilities.js';
import { logger } from '@study-studio/shared';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * 显示模式：
   * - embedded: 嵌在工作台内部，发生异常时不破坏侧边栏与顶栏
   * - fullscreen: 全屏容灾，用于包裹根组件
   */
  variant?: 'embedded' | 'fullscreen';
  /** 发生错误时的自定义降级标题 */
  title?: string;
  /** 发生错误时的提示内容 */
  message?: string;
  /** 重试回调 */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    logger.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      showDetails: false,
    });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleCopyDetails = () => {
    const { error, errorInfo } = this.state;
    const diagnosticText = `Lingua Studio Error Diagnostic
Error: ${error?.name}: ${error?.message}
Stack: ${error?.stack || 'N/A'}
Component Stack: ${errorInfo?.componentStack || 'N/A'}
Timestamp: ${new Date().toISOString()}
UserAgent: ${getPlatform().getUserAgent()}
`;
    getPlatform()
      .clipboardWriteText(diagnosticText)
      .then(() => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2000);
      })
      .catch(() => {
        // 剪贴板两条通道都失败时给用户明确反馈（详情区 select-text 可手动复制）。
        logger.warn('[ErrorBoundary] 诊断日志复制失败：剪贴板不可用或被浏览器拒绝');
        toast.error('复制失败：浏览器拒绝了剪贴板写入，请展开详情手动复制。');
      });
  };

  override render() {
    const { hasError, error, errorInfo, copied, showDetails } = this.state;
    const {
      children,
      variant = 'embedded',
      title = '工作区遇到了一点意外',
      message = '此模块在渲染过程中遇到了临时异常。您的个人学习数据与做题资产已安全保存，请尝试恢复。',
    } = this.props;

    if (!hasError) {
      return children;
    }

    const isFullscreen = variant === 'fullscreen';

    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`flex items-center justify-center p-6 transition-colors ${ isFullscreen ? 'min-h-screen w-full bg-surface-paper-fixed dark:bg-ink-h141312 text-ink-soft' : 'min-h-[22rem] w-full rounded-2xl border border-line-rose-200o80 dark:border-line-rose-900o40 bg-veil-whiteo80 dark:bg-veil-stone-900o60 backdrop-blur-md shadow-sm' }`}
      >
        <div className="max-w-lg w-full text-center space-y-4">
          {/* 异常警示徽章图标 */}
          <div className="inline-flex p-3 rounded-2xl bg-wash-rose-500o10-rose-500o15 border border-line-rose-500o20 text-ink-rose-600-rose-400">
            <AlertTriangle className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-2">
              <h3 className="text-lg font-bold font-serif text-ink">
                {title}
              </h3>
              <Badge variant="destructive" className="text-[10px]">
                {error?.name || 'Exception'}
              </Badge>
            </div>
            <p className="text-xs text-ink-ghost leading-relaxed px-4">
              {message}
            </p>
          </div>

          {/* 交互行动区 */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <Button
              variant="default"
              size="sm"
              onClick={this.handleReset}
              className="gap-1.5 bg-tone-amber-600 hover:bg-tone-amber-700 text-tone-white dark:bg-tone-amber-500 dark:hover:bg-tone-amber-600 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重新加载此区域</span>
            </Button>

            {isFullscreen && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => (window.location.href = '/')}
                className="gap-1.5 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={this.handleCopyDetails}
              className="gap-1.5 text-ink-faint cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-tone-emerald-600" />
                  <span className="text-tone-emerald-600">已复制诊断日志</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制错误日志</span>
                </>
              )}
            </Button>
          </div>

          {/* 可折叠的技术诊断详情 */}
          <div className="pt-2 text-left">
            <button
              type="button"
              onClick={() => this.setState({ showDetails: !showDetails })}
              className="text-[11px] text-ink-stone-400 hover:text-ink-faint flex items-center gap-1 mx-auto cursor-pointer transition-colors"
            >
              {showDetails ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              <span>{showDetails ? '收起技术详情' : '展开技术诊断详情'}</span>
            </button>

            {showDetails && (
              <div className="mt-2.5 p-3 rounded-xl bg-surface-stone-100-stone-950 border border-line-soft text-[11px] font-mono text-ink-faint max-h-48 overflow-y-auto space-y-1.5 select-text">
                <div className="font-semibold text-ink-rose-600-rose-400">
                  {error?.toString()}
                </div>
                {error?.stack && (
                  <pre className="text-[10px] whitespace-pre-wrap text-ink-ghost">
                    {error.stack}
                  </pre>
                )}
                {errorInfo?.componentStack && (
                  <pre className="text-[10px] whitespace-pre-wrap text-ink-hint border-t border-line-soft pt-1">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
