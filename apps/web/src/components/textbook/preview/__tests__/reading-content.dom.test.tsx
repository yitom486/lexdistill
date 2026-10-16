import { expect, it, mock } from 'bun:test';
import React from 'react';
import { act, setupDom } from '../../../toc/__tests__/dom-setup.js';
import { useTtsStore } from '../../../../stores/useTtsStore.js';
import type { StudyDetail } from '../study-view.js';

/**
 * UI-R05 内容优先阅读：句段去框化但控制齐备、朗读状态、译文/角色/划选、
 * 长文本混排不断言截断、导学与知识点交互保留。TTS 为受控 mock，不真实发声。
 */
const LONG_CJK = 'これは何ですか。それは日本語の本です。'.repeat(12);
const contentBase = {
  vocabulary: [],
  grammar: [],
  articles: [],
  sentences: [],
  exercises: [],
  material: null,
};

function readingContent() {
  return {
    ...contentBase,
    articles: [
      {
        id: 'a1',
        title: '教室对话',
        text: '全文备用文本',
        translation: '全文译文',
        source: 'TEXTBOOK' as const,
      },
    ],
  };
}

function studyFor() {
  return {
    introduction: '',
    goals: [],
    steps: [],
    summary: '',
    selfCheck: [],
    articles: {
      a1: [
        { text: LONG_CJK, translation: '长句译文', speaker: '田中', gender: 'male' as const },
        { text: 'Hello, where is the station? 역은 어디입니까?', translation: '混排译文', speaker: '佐藤', gender: 'female' as const },
        { text: 'これは本です。', translation: '这是一本书。' },
      ],
    },
  };
}

it('reading turns are borderless rows with full controls and playing state', async () => {
  if (process.env['LINGUA_READING_CONTENT_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_READING_CONTENT_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  const spoken: { text: string; lang: string | undefined }[] = [];
  mock.module('../../../UnifiedTtsPlayer.js', () => ({
    UnifiedTtsPlayer: ({ text, lang, label }: { text: string; lang?: string; label?: string }) => (
      <button type="button" aria-label={label} data-text={text} data-lang={lang} onClick={() => spoken.push({ text, lang })}>
        {label}
      </button>
    ),
  }));
  const { InteractiveReading } = await import('../InteractiveReading.js');
  const doc = dom.dom.window.document;
  const explained: StudyDetail[] = [];
  const explainStub = (detail: StudyDetail, label: string, disabled = false) => (
    <button type="button" disabled={disabled} onClick={() => explained.push(detail)}>{label}</button>
  );
  try {
    await act(async () => {
      dom.root.render(
        <InteractiveReading content={readingContent()} showTranslation={false} language="ja" explain={explainStub} study={studyFor()} />
      );
    });
    const turns = [...doc.querySelectorAll('[data-testid="reading-turn"]')];
    expect(turns).toHaveLength(3);
    // 去框化：非播放态句行无边框/底色盒
    for (const turn of turns) {
      const cls = (turn as HTMLElement).className;
      expect(cls.includes('border') || cls.includes('bg-')).toBe(false);
    }
    // 长文本与混排完整呈现，不断言截断
    expect(doc.body.textContent).toContain(LONG_CJK);
    expect(doc.body.textContent).toContain('Hello, where is the station? 역은 어디입니까?');
    const original = turns[0]!.querySelector('p');
    expect(original?.className.includes('line-clamp')).toBe(false);
    // 控制全部可达：听一句/看译文/讲解（禁用态因无划选）
    const listen = turns[0]!.querySelector('button[aria-label="听这一句"]') as HTMLButtonElement;
    expect(listen).toBeDefined();
    await act(async () => listen.click());
    expect(spoken[0]).toEqual({ text: LONG_CJK, lang: 'JA' });
    const toggle = [...turns[0]!.querySelectorAll('button')].find((b) => b.textContent === '看译文');
    expect(toggle).toBeDefined();
    await act(async () => (toggle as HTMLButtonElement).click());
    expect(turns[0]!.querySelector('[data-testid="inline-translation"]')?.textContent).toBe('长句译文');
    const pending = [...doc.querySelectorAll('button')].find((b) => b.textContent === '先选中正文中的文字');
    expect((pending as HTMLButtonElement | undefined)?.disabled).toBe(true);
    // Actual DOM selection enables the action and passes exactly the selected text.
    const selection = dom.dom.window.getSelection()!;
    const range = doc.createRange();
    range.setStart(original!.firstChild!, 0);
    range.setEnd(original!.firstChild!, 8);
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => original!.dispatchEvent(new dom.dom.window.MouseEvent('mouseup', { bubbles: true })));
    const selectedAction = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '讲解选中文字');
    expect(selectedAction?.disabled).toBe(false);
    await act(async () => selectedAction!.click());
    expect(explained.at(-1)).toMatchObject({ title: '选中文字讲解', text: LONG_CJK.slice(0, 8) });
    selection.removeAllRanges();
    await act(async () => original!.dispatchEvent(new dom.dom.window.MouseEvent('mouseup', { bubbles: true })));
    expect([...doc.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '先选中正文中的文字')?.disabled).toBe(true);

    // 朗读态：当前句获高亮区，原文仍在
    await act(async () => {
      useTtsStore.setState({ isSpeaking: true, currentText: LONG_CJK });
    });
    const playingTurn = [...doc.querySelectorAll('[data-testid="reading-turn"]')].find((t) =>
      (t as HTMLElement).className.includes('bg-wash')
    );
    expect(playingTurn).toBeDefined();
    expect(playingTurn!.textContent).toContain(LONG_CJK);
    await act(async () => {
      useTtsStore.setState({ isSpeaking: false, currentText: '' });
    });

    // 角色练习：遮罩与揭示不串状态（键盘打开经本仓既有模式验证）
    const settle = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    };
    const trigger = doc.querySelector<HTMLElement>('[aria-label="选择对话练习角色"]');
    expect(trigger).toBeDefined();
    await act(async () => trigger!.focus());
    await act(async () => {
      trigger!.dispatchEvent(new dom.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await settle();
    const option = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === '我来扮演：田中');
    expect(option).toBeDefined();
    await act(async () => option!.focus());
    await act(async () => option!.click());
    await settle();
    const masked = [...doc.querySelectorAll('[data-testid="reading-turn"]')].find((t) => t.textContent?.includes('先自己说'));
    expect(masked).toBeDefined();
    expect(masked!.textContent).not.toContain(LONG_CJK);
    const reveal = [...masked!.querySelectorAll('button')].find((b) => b.textContent === '先自己说，再揭示这句台词');
    await act(async () => (reveal as HTMLButtonElement).click());
    expect(masked!.textContent).toContain(LONG_CJK);
  } finally {
    try { useTtsStore.setState({ isSpeaking: false, currentText: '' }); } catch { /* ignore */ }
    dom.teardown();
  }
}, 20000);

it('sentences, guide and knowledge keep controls without nested boxes', async () => {
  if (process.env['LINGUA_READING_CONTENT_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_READING_CONTENT_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../UnifiedTtsPlayer.js', () => ({
    UnifiedTtsPlayer: ({ text, lang, label }: { text: string; lang?: string; label?: string }) => (
      <button type="button" aria-label={label} data-text={text} data-lang={lang}>{label}</button>
    ),
  }));
  const { PreviewSentences } = await import('../PreviewContentSections.js');
  const { StudyGuide } = await import('../StudyGuide.js');
  const { KnowledgeCard } = await import('../KnowledgeCard.js');
  const doc = dom.dom.window.document;
  const explainStub = (_detail: unknown, label: string, disabled = false) => (
    <button type="button" disabled={disabled}>{label}</button>
  );
  try {
    // 句子：去框分行，序号/说话者/TTS/讲解/译文齐备
    const sentences = [
      { id: 's1', speaker: '田中', text: LONG_CJK, translation: '句译文', explanation: '句法说明', source: 'TEXTBOOK' as const },
    ];
    await act(async () => {
      dom.root.render(
        <PreviewSentences content={{ ...contentBase, sentences }} showTranslation language="ja" explain={explainStub} />
      );
    });
    const rows = [...doc.querySelectorAll('article')];
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).className.includes('border')).toBe(false);
    expect(doc.body.textContent).toContain('田中：');
    expect(doc.body.textContent).toContain(LONG_CJK);
    expect(doc.querySelector('button[aria-label="听读 / 跟读"]')).not.toBeNull();
    expect(doc.body.textContent).toContain('句译文');
    const more = [...doc.querySelectorAll('button')].find((b) => b.textContent === '查看译文与用法');
    await act(async () => (more as HTMLButtonElement).click());
    expect(doc.body.textContent).toContain('句法说明');

    // 导学：自检翻转、主线导航、自查展开
    const navigated: string[] = [];
    await act(async () => {
      dom.root.render(
        <StudyGuide
          study={{
            introduction: '导语', goals: ['掌握问候'], steps: [{ title: '去阅读', description: '读', section: 'articles' }],
            summary: '总结', selfCheck: [{ question: '会问候吗？', answer: 'はい' }], articles: {},
          }}
          summary={false}
          onNavigate={(s) => navigated.push(s)}
        />
      );
    });
    const check = doc.querySelector('button[aria-label="自检：掌握问候"]') as HTMLButtonElement;
    expect(check?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => check.click());
    expect(check.getAttribute('aria-pressed')).toBe('true');
    const step = [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('去阅读'));
    await act(async () => (step as HTMLButtonElement).click());
    expect(navigated).toEqual(['articles']);
    await act(async () => {
      dom.root.render(
        <StudyGuide
          study={{
            introduction: '', goals: [], steps: [],
            summary: '总结', selfCheck: [{ question: '会问候吗？', answer: 'はい、できます' }], articles: {},
          }}
          summary
          onNavigate={() => {}}
        />
      );
    });
    const self = [...doc.querySelectorAll('button')].find((b) => b.textContent === '对照参考要点');
    await act(async () => (self as HTMLButtonElement).click());
    expect(doc.body.textContent).toContain('はい、できます');

    // 知识点：接续去框，AI 触发展开，无 onAsk 时追问禁用
    await act(async () => {
      dom.root.render(
        <KnowledgeCard
          point={{
            id: 'g1', kind: 'USAGE', title: 'てもいい', connection: 'て形＋もいい',
            explanation: '许可表达', examples: [{ text: '見てもいいですか', translation: '可以看吗' }],
            aiExplanation: '补充', source: 'TEXTBOOK' as const,
          }}
          index={0}
          language="ja"
          showTranslation
        />
      );
    });
    expect(doc.body.textContent).toContain('て形＋もいい');
    const ai = [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('补充说明'));
    await act(async () => (ai as HTMLButtonElement).click());
    expect(doc.body.textContent).toContain('补充');
    const ask = [...doc.querySelectorAll('button')].find((b) => b.textContent?.includes('向 AI 追问'));
    expect((ask as HTMLButtonElement).disabled).toBe(true);
  } finally { dom.teardown(); }
}, 20000);
