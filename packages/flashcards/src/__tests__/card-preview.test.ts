import { describe, expect, it } from 'bun:test';
import { isOk, isErr } from '@study-studio/shared';
import {
  previewCard,
  narrowCardSourceEntry,
  type CardPreviewPorts,
  type PreviewCardRequest,
} from '../index.js';
import { getBuiltinCardFormat, type AnkiCardFormat, type CardSourceEntry } from '@study-studio/flashcard-core';

/** M7-6 卡片预览用例测试（port 桩，不碰持久化）。 */
function builtin(): AnkiCardFormat {
  const format = getBuiltinCardFormat('study-basic');
  if (!format) throw new Error('missing builtin study-basic');
  return format;
}

const ENTRY: CardSourceEntry = {
  headword: '食べる',
  reading: 'たべる',
  meanings: ['to eat'],
};

function portsWith(format: AnkiCardFormat | undefined): CardPreviewPorts {
  return {
    loadFormat: async () => format,
    narrowInlineFormat: async () => undefined,
  };
}

describe('previewCard', () => {
  it('格式不存在 → E_INVALID_INPUT（找不到模板）', async () => {
    const request: PreviewCardRequest = { formatId: 'no-such', entry: ENTRY };
    const res = await previewCard(portsWith(undefined), request);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_INVALID_INPUT');
      expect(res.error.userMessage).toContain('找不到该卡片模板');
    }
  });

  it('模板草稿结构不正确 → E_INVALID_INPUT（草稿）', async () => {
    const request: PreviewCardRequest = {
      inlineFormat: { id: 'x' } as unknown as AnkiCardFormat,
      entry: ENTRY,
    };
    const res = await previewCard(portsWith(builtin()), request);
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_INVALID_INPUT');
      expect(res.error.userMessage).toContain('模板草稿');
    }
  });

  it('模板校验失败也返回渲染结果 + issues（不拦截）', async () => {
    const broken: AnkiCardFormat = { ...builtin(), frontTemplate: '{{type:Expression}}' };
    const res = await previewCard(portsWith(broken), { entry: ENTRY });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.issues.length).toBeGreaterThan(0);
    expect(typeof res.value.rendered.frontHtml).toBe('string');
  });

  it('成功渲染：字段落位 + 无 issues', async () => {
    const res = await previewCard(portsWith(builtin()), { entry: ENTRY });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.issues).toEqual([]);
    expect(res.value.format.id).toBe('study-basic');
    expect(res.value.rendered.frontHtml).toContain('食べる');
  });

  it('行内草稿经 port 收窄后渲染（只渲染不入库由 port 保证）', async () => {
    let sawDraft = false;
    const ports: CardPreviewPorts = {
      loadFormat: async () => {
        throw new Error('must not load stored format for inline preview');
      },
      narrowInlineFormat: async (draft: unknown) => {
        sawDraft = true;
        expect(typeof draft).toBe('object');
        return builtin();
      },
    };
    const res = await previewCard(ports, { inlineFormat: builtin(), entry: ENTRY });
    expect(sawDraft).toBe(true);
    expect(isOk(res)).toBe(true);
  });
});

describe('narrowCardSourceEntry', () => {
  it('词条缺失/损坏 → undefined（调用方拒绝，非“不存在”臆造）', () => {
    expect(narrowCardSourceEntry(undefined)).toBeUndefined();
    expect(narrowCardSourceEntry({ headword: '  ', meanings: [] })).toBeUndefined();
    expect(narrowCardSourceEntry({ headword: 'a' })).toBeUndefined();
  });

  it('有效词条收窄截断（防超长）', () => {
    const entry = narrowCardSourceEntry({
      headword: 'x'.repeat(200),
      meanings: ['m1', 42, 'm2'],
      reading: 'y',
    });
    expect(entry?.headword.length).toBe(128);
    expect(entry?.meanings).toEqual(['m1', 'm2']);
    expect(entry?.reading).toBe('y');
  });
});
