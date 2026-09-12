import { describe, expect, it } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TocResultDialogContent } from '../TocResultDialog.js';
import { TocReviewConfigDialogContent, TocReviewProgressDialogContent } from '../TocReviewDialogs.js';
import type { TocBaselineData, TocReviewDraft } from '../../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P3.5 结果 Dialog SSR 断言（无 DOM、无网络）。
 * 交互（筛选切换/逐条采用）由 lib 单测 + 真机截图覆盖；此处锁定结构、
 * 列对齐、零写（无 mutation 文案）与适配逻辑。
 */

const DRAFT: TocReviewDraft = {
  entries: [
    { entryId: 'b0', title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null, needsReview: false },
    { entryId: 'n0', title: '第2課 文法', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high', needsReview: false },
    { entryId: 'b1', title: '文法 まとめ', printedPage: 30, level: 2, kind: 'section', confidence: 'medium', needsReview: true },
    // 生产真实形状：合并后 entries 已删条目（b2 remove 只活在 diff.before 快照里）。
  ],
  warnings: ['n0 页码请核对图片'],
  diff: [
    { entryId: 'b0', change: 'keep', before: { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null }, after: { title: '第1課 会話', printedPage: 12, level: 1, kind: 'lesson', confidence: null }, reason: null, needsReview: false },
    { entryId: 'n0', change: 'add', before: null, after: { title: '第2課 文法', printedPage: 20, level: 1, kind: 'lesson', confidence: 'high' }, reason: '图片可见漏项', needsReview: false },
    { entryId: 'b1', change: 'update', before: { title: '文法', printedPage: 30, level: 2, kind: 'section', confidence: null }, after: { title: '文法 まとめ', printedPage: 30, level: 2, kind: 'section', confidence: 'medium' }, reason: '图片确认标题', needsReview: true },
    { entryId: 'b2', change: 'remove', before: { title: '旧付録', printedPage: 99, level: 2, kind: 'section', confidence: null }, after: null, reason: '正文确认非目录行', needsReview: false },
  ],
};

function renderContent(overrides: Partial<Parameters<typeof TocResultDialogContent>[0]> = {}): string {
  return renderToStaticMarkup(
    React.createElement(TocResultDialogContent, {
      rangeText: '16–21',
      baselineCount: 3,
      draft: DRAFT,
      onClose: () => {},
      ...overrides,
    })
  );
}

describe('P3.5 结果 Dialog 内容（SSR）', () => {
  it('六列严格对齐 + 四态徽标 + 变更依据 + 警告', () => {
    const html = renderContent();
    for (const col of ['状态', '标题', '印刷页', '层级', '置信度', '变更依据']) {
      expect(html).toContain(col);
    }
    expect(html).toContain('保留');
    expect(html).toContain('新增');
    expect(html).toContain('修改');
    expect(html).toContain('删除');
    expect(html).toContain('图片可见漏项');
    expect(html).toContain('n0 页码请核对图片');
    expect(html).toContain('待确认');
    // keep 行 confidence 为 null 显示破折号，不臆造
    expect(html).toContain('—');
    // 印刷页非物理页说明
    expect(html).toContain('非 PDF 物理页');
  });

  it('默认完整目录；initialFilter=changed 只留变更行', () => {
    const all = renderContent();
    expect(all).toContain('第1課 会話');
    expect(all).toContain('第2課 文法');
    const changed = renderContent({ initialFilter: 'changed' });
    expect(changed).not.toContain('第1課 会話');
    expect(changed).toContain('第2課 文法');
    expect(changed).toContain('旧付録');
    expect(changed).toContain('仅看变更');
  });

  it('删除行打删除线；footer 采用摘要 + 未入库声明', () => {
    const html = renderContent();
    expect(html).toContain('line-through');
    expect(html).toContain('删前：旧付録');
    expect(html).toContain('采用 3 项变更');
    expect(html).toContain('只存本页，未入库');
    expect(html).toContain('稍后处理');
  });

  it('entries 缺席的 remove 行走 diff 快照（只读 + 可确认删除）', () => {
    const html = renderContent();
    // 快照行仍渲染：删除徽标 + 删前标题 + 确认按钮（确认=确认删除）
    expect(html).toContain('删除');
    expect(html).toContain('删前：旧付録');
    expect(html).toContain('确认本条');
    // 只读：标题/页码输入框 disabled，层级 Select 不可改（disabled 透出）
    expect(html).toContain('aria-label="条目标题 b2"');
    const changed = renderContent({ initialFilter: 'changed' });
    expect(changed).toContain('旧付録');
  });

  it('可读性：正文≥14px、行高≥36px、表头 sticky、状态不只靠颜色', () => {
    const html = renderContent();
    // 正文单元格 14px
    expect(html).toContain('text-[14px]');
    // 行高：输入框 h-9（36px）+ 行 min-h
    expect(html).toContain('min-h-[36px]');
    // 表头 sticky
    expect(html).toContain('sticky');
    // 状态徽标是文字（保留/新增/修改/删除），不是纯色块
    for (const label of ['保留', '新增', '修改', '删除']) {
      expect(html).toContain(label);
    }
    // 修改/删除行另有文字证据行（原：/删前：），双通道
    expect(html).toContain('原：');
    expect(html).toContain('删前：');
  });

  it('逐条输入框 aria齊备；改后值只活 state（SSR 断言初始值）', () => {
    const html = renderContent();
    expect(html).toContain('aria-label="条目标题 b0"');
    expect(html).toContain('aria-label="印刷页码 n0"');
    expect(html).toContain('aria-label="层级 b1"');
    expect(html).toContain('确认本条');
  });
});

describe('P3.5 配置/进度 Dialog 内容（SSR）', () => {
  const baseline = {
    entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
    verdict: 'usable',
    pageEvidence: [{ page: 16, excerpt: 'x' }],
  } as unknown as TocBaselineData;

  it('配置 Dialog：范围/基线只读 + 开始重建（禁用态可断言）', () => {
    const html = renderToStaticMarkup(
      React.createElement(TocReviewConfigDialogContent, {
        rangeText: '16–21',
        baseline,
        evidencePages: 1,
        sizeHint: null,
        reviewDisabledReason: null,
        starting: false,
        savedModel: '',
        savedEffort: '',
        sessionModel: '',
        sessionEffort: '',
        onStart: () => {},
        onClose: () => {},
      })
    );
    expect(html).toContain('AI 重建目录');
    expect(html).toContain('16–21');
    expect(html).toContain('开始重建');
    const disabled = renderToStaticMarkup(
      React.createElement(TocReviewConfigDialogContent, {
        rangeText: '16–21',
        baseline,
        evidencePages: 1,
        sizeHint: null,
        reviewDisabledReason: '先提取目录基线',
        starting: false,
        savedModel: 'm-saved',
        savedEffort: 'high',
        sessionModel: '',
        sessionEffort: '',
        onStart: () => {},
        onClose: () => {},
      })
    );
    expect(disabled).toContain('disabled');
  });

  it('配置 Dialog：模型使用默认/指定 + effort + 记住偏好 + 生效来源行', () => {
    const html = renderToStaticMarkup(
      React.createElement(TocReviewConfigDialogContent, {
        rangeText: '16–21',
        baseline,
        evidencePages: 1,
        sizeHint: null,
        reviewDisabledReason: null,
        starting: false,
        savedModel: 'm-saved',
        savedEffort: 'high',
        sessionModel: '',
        sessionEffort: '',
        onStart: () => {},
        onClose: () => {},
      })
    );
    expect(html).toContain('使用默认');
    expect(html).toContain('指定模型');
    expect(html).toContain('思考等级');
    expect(html).toContain('记住为偏好');
    // 已保存偏好回显：指定模型被选中且来源行展示偏好值
    expect(html).toContain('m-saved');
  });

  it('进度 Dialog：不定长进度 + 不可取消声明', () => {
    const html = renderToStaticMarkup(
      React.createElement(TocReviewProgressDialogContent, { rangeText: '16–21' })
    );
    expect(html).toContain('正在重建');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('不可取消');
  });
});
