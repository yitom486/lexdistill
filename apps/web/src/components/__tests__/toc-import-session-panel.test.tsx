import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SessionExecuteDialogContent,
  SessionPrepareDialogContent,
  TocImportSessionPanelView,
  type TocImportSessionPanelViewProps,
} from '../TocImportSessionPanel.js';
import type { SessionView } from '../../lib/toc-import-session-flow.js';

/**
 * CMD-LINGUA-P5D2D：会话面板纯视图 SSR 断言（无 DOM、无网络）。
 * 守门由 lib 单测覆盖；此处锁定按钮有无、文案与诚实声明。
 */

function baseProps(overrides: Partial<TocImportSessionPanelViewProps> = {}): TocImportSessionPanelViewProps {
  return {
    prepareVisible: true,
    prepareBlockReason: null,
    prepareDialogOpen: false,
    docTitle: '',
    preparing: false,
    prepareError: null,
    session: null,
    sessionLoading: false,
    sessionError: null,
    reusedNote: false,
    chunkBlockReasons: [],
    executeDialog: null,
    executing: false,
    executeError: null,
    executeResult: null,
    onOpenPrepareDialog: () => {},
    onClosePrepareDialog: () => {},
    onDocTitleChange: () => {},
    onConfirmPrepare: () => {},
    onSelectChunkExecute: () => {},
    onCloseExecuteDialog: () => {},
    onConfirmExecute: () => {},
    ...overrides,
  };
}

function render(props: Partial<TocImportSessionPanelViewProps> = {}): string {
  return renderToStaticMarkup(TocImportSessionPanelView(baseProps(props)));
}

const SESSION: SessionView = {
  sessionId: 's1',
  status: 'running',
  documentId: 'doc_1',
  totalChunks: 2,
  completedChunks: 1,
  chunks: [
    { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 }, status: 'completed', attempts: 1 },
    { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 }, status: 'prepared', attempts: 0 },
  ],
  next: { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 } },
};

describe('P5D2D TocImportSessionPanelView（SSR）', () => {
  it('初始：准备按钮与刷新诚实声明，无自动按钮', () => {
    const html = render();
    expect(html).toContain('准备导入会话');
    expect(html).toContain('刷新后状态丢失');
    expect(html).toContain('不复用旧进度');
    expect(html).not.toContain('一键导入');
    expect(html).not.toContain('自动执行');
    expect(html).not.toContain('后台执行');
    expect(html).not.toContain('自动重试');
  });

  it('gate 未满足：无准备按钮，只有原因', () => {
    const html = render({ prepareVisible: false, prepareBlockReason: '请先得到有效的分段预览' });
    expect(html).not.toContain('准备导入会话');
    expect(html).toContain('请先得到有效的分段预览');
  });

  it('准备 Dialog：只建计划文案 + 取消', () => {
    const html = renderToStaticMarkup(
      SessionPrepareDialogContent({ docTitle: '', preparing: false, onClose: () => {}, onDocTitleChange: () => {}, onConfirm: () => {} })
    );
    expect(html).toContain('这会创建可恢复导入计划，但不会立刻导入教材内容');
    expect(html).toContain('同一计划重复准备将复用同一会话');
    expect(html).toContain('取消');
    expect(html).toContain('确认创建');
  });

  it('prepared 会话显示下一课与执行按钮', () => {
    const prepared: SessionView = { ...SESSION, status: 'prepared', documentId: null, completedChunks: 0 };
    const html = render({ session: prepared });
    expect(html).toContain('已准备');
    expect(html).toContain('0/2 课已完成');
    expect(html).toContain('暂无目标教材');
    expect(html).toContain('导入下一课');
    expect(html).toContain('尝试 1 次');
  });

  it('reused 文案', () => {
    const html = render({ session: SESSION, reusedNote: true });
    expect(html).toContain('reused');
    expect(html).toContain('未重复创建');
  });

  it('终态只有 blocker：target_deleted/long/multi', () => {
    const dead = render({
      session: { ...SESSION, status: 'target_deleted', next: null },
      chunkBlockReasons: [{ ordinal: -1, message: '目标已删除，该会话不可恢复、不可执行' }],
    });
    expect(dead).not.toContain('导入下一课');
    expect(dead).toContain('目标已删除');
    const longBlocked = render({
      session: SESSION,
      chunkBlockReasons: [{ ordinal: 1, message: '该课共 68 页（单次上限 30 页），不能执行' }],
    });
    expect(longBlocked).not.toContain('导入下一课');
    expect(longBlocked).toContain('68 页');
  });

  it('执行 Dialog：仅一课声明 + 取消', () => {
    const html = renderToStaticMarkup(
      SessionExecuteDialogContent({
        dialog: { lessonTitle: '第2課', printedStart: 31, physicalFrom: 36, physicalTo: 40, pages: 5 },
        executing: false,
        onClose: () => {},
        onConfirm: () => {},
      })
    );
    expect(html).toContain('仅导入这一课，不会自动继续下一课');
    expect(html).toContain('第2課');
    expect(html).toContain('取消');
    expect(html).toContain('确认导入');
  });

  it('成功摘要：documentId + 仅一课声明', () => {
    const html = render({
      session: SESSION,
      executeResult: { documentId: 'doc_1', lessonId: 'l2', lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 } },
    });
    expect(html).toContain('已导入：第2課');
    expect(html).toContain('doc_1');
    expect(html).toContain('未自动继续下一课');
  });

  it('pending 禁重复：执行按钮 disabled；空闲可点', () => {
    const prepared: SessionView = { ...SESSION, status: 'prepared', documentId: null, completedChunks: 0 };
    const busy = render({ session: prepared, executing: true });
    expect(busy).toContain('disabled=""');
    const idle = render({ session: prepared, executing: false });
    expect(idle).toContain('导入下一课');
    expect(idle).not.toContain('disabled=""');
  });

  it('失败只显 userMessage', () => {
    const html = render({ session: SESSION, executeError: '目标教材已被外部修改，拒绝追加' });
    expect(html).toContain('目标教材已被外部修改，拒绝追加');
  });
});
