import { expect, it, mock } from 'bun:test';
import React from 'react';
import { act, setupDom } from '../../../toc/__tests__/dom-setup.js';
import type { LearningLibraryBook } from '../library-view.js';

/**
 * UI-R04 书库与章节层级：可继续学习分区（数组真实顺序，不称最近）、
 * 过期/跨书记忆回落浏览、空/加载/失败/留缓存、长标题、键盘不串动作。
 */
const emptyContent = { vocabulary: [], grammar: [], articles: [], sentences: [], exercises: [], material: null };

function book(id: string, title: string, chapters: { id: string; title: string }[]): LearningLibraryBook {
  return {
    id, title, language: 'JA', level: 'N5', temporary: false,
    chapters: chapters.map((c) => ({ id: c.id, title: c.title, subtitle: '', content: { ...emptyContent } })),
  };
}

it('library partitions continuable books and validates remembered chapters', async () => {
  if (process.env['LINGUA_LIBRARY_STATES_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_LIBRARY_STATES_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const dom = await setupDom(true);
  mock.module('../../../utils/audio.js', () => ({ sound: { playClick() {} }, speechStudio: { speak: async () => {} } }));
  const { TextbookLibraryHome } = await import('../TextbookLibraryHome.js');
  const { TextbookChapterList } = await import('../TextbookChapterList.js');
  const doc = dom.dom.window.document;
  const bookA = book('book-a', 'A书', [{ id: 'a-c1', title: '第一课' }, { id: 'a-c2', title: '第二课超长标题超长标题超长标题超长标题' }]);
  const bookB = book('book-b', titleB(), [{ id: 'b-c1', title: 'B第一课' }]);
  function titleB(): string { return 'B书'; }
  const opens: string[] = [];
  const browses: string[] = [];
  const renderHome = async (remembered: Record<string, string>, extra?: { books?: LearningLibraryBook[]; loading?: boolean; loadError?: boolean; hasSavedResult?: boolean }) => {
    await act(async () => {
      dom.root.render(
        <TextbookLibraryHome
          books={extra?.books ?? [bookA, bookB]}
          rememberedChapters={remembered}
          onOpen={(b) => opens.push(b.id)}
          onBrowse={(b) => browses.push(b.id)}
          onImport={() => {}}
          onRefresh={() => {}}
          onOpenExerciseExamples={() => {}}
          loading={extra?.loading ?? false}
          loadError={extra?.loadError}
          hasSavedResult={extra?.hasSavedResult ?? true}
        />
      );
    });
  };
  const continueSection = () => doc.querySelector('section[aria-label="继续学习"]');
  const allSection = () => doc.querySelector('section[aria-label="其他教材"], section[aria-label="全部教材"]');
  try {
    // 1. 分区：A（有效记忆）在继续学习，B 在全部教材；不称最近
    await renderHome({ 'book-a': 'a-c2' });
    expect(continueSection()).not.toBeNull();
    expect(continueSection()!.textContent).toContain('A书');
    expect(continueSection()!.textContent).toContain('上次浏览：第二课超长标题');
    expect(continueSection()!.textContent).not.toContain('B书');
    expect(allSection()!.textContent).toContain('B书');
    expect(allSection()!.textContent).not.toContain('A书');
    expect(doc.body.textContent).not.toContain('最近');

    // 2. 过期记忆回落：无上次浏览、无继续入口，回到紧凑浏览
    await renderHome({ 'book-a': 'gone' });
    expect(continueSection()).toBeNull();
    expect(doc.body.textContent).not.toContain('上次浏览');
    expect(allSection()!.textContent).toContain('A书');

    // 3. 跨书记忆视为无记忆
    await renderHome({ 'book-a': 'b-c1' });
    expect(continueSection()).toBeNull();
    expect(doc.body.textContent).not.toContain('上次浏览');

    // 4. 两本皆可继续：各归其书，点击不串
    await renderHome({ 'book-a': 'a-c1', 'book-b': 'b-c1' });
    const clickByText = async (text: string) => {
      const btn = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
      expect(btn, `missing ${text}`).toBeDefined();
      await act(async () => btn!.click());
    };
    await clickByText('继续学习');
    expect(opens).toEqual(['book-a']);
    // 第二本的继续按钮
    const continues = [...doc.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent?.trim() === '继续学习'
    );
    expect(continues).toHaveLength(2);
    await act(async () => continues[1]!.click());
    expect(opens).toEqual(['book-a', 'book-b']);

    // 5. 键盘与嵌套：浏览与继续互不包含，各触发一次
    await renderHome({ 'book-a': 'a-c1' });
    const browse = doc.querySelector<HTMLButtonElement>('button[aria-label="查看章节：A书"]');
    const cont = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === '继续学习');
    expect(browse).toBeDefined();
    expect(cont).toBeDefined();
    expect(browse!.contains(cont!)).toBe(false);
    expect(cont!.contains(browse!)).toBe(false);
    await act(async () => cont!.click());
    expect(opens).toEqual(['book-a', 'book-b', 'book-a']);
    await act(async () => browse!.click());
    expect(browses).toEqual(['book-a']);

    // 6. 空库 / 加载 / 失败 / 留缓存
    let imported = 0;
    let refreshed = 0;
    await act(async () => {
      dom.root.render(
        <TextbookLibraryHome
          books={[]}
          rememberedChapters={{}}
          onOpen={() => {}}
          onBrowse={() => {}}
          onImport={() => { imported += 1; }}
          onRefresh={() => { refreshed += 1; }}
          onOpenExerciseExamples={() => {}}
          loading={false}
          hasSavedResult
        />
      );
    });
    expect(doc.body.textContent).toContain('暂无教材');
    const importBtn = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('导入教材'));
    await act(async () => importBtn!.click());
    expect(imported).toBe(1);

    await renderHome({}, { books: [], loading: true, hasSavedResult: false });
    expect(doc.body.textContent).toContain('正在读取已保存教材');

    await renderHome({}, { books: [], loadError: true, hasSavedResult: false });
    expect(doc.body.textContent).toContain('暂时无法读取已保存教材');
    const retry = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === '重试');
    expect(retry).toBeDefined();

    await renderHome({ 'book-a': 'a-c1' }, { loadError: true });
    expect(doc.body.textContent).toContain('可能不是最新');
    expect(doc.body.textContent).toContain('A书');

    // 7. 章节列表：过期记忆无徽标，有效记忆仅标当行，返回与选择
    const backs: number[] = [];
    const selects: string[] = [];
    await act(async () => {
      dom.root.render(
        <TextbookChapterList
          book={bookA}
          rememberedChapterId="gone"
          onSelect={(id) => selects.push(id)}
          onBack={() => backs.push(1)}
        />
      );
    });
    expect(doc.body.textContent).not.toContain('上次浏览');
    await act(async () => {
      dom.root.render(
        <TextbookChapterList
          book={bookA}
          rememberedChapterId="a-c1"
          onSelect={(id) => selects.push(id)}
          onBack={() => backs.push(1)}
        />
      );
    });
    const row1 = doc.querySelector('button[aria-label="学习章节：第一课"]');
    const row2 = doc.querySelector('button[aria-label^="学习章节：第二课"]');
    expect(row1!.textContent).toContain('上次浏览');
    expect(row2!.textContent).not.toContain('上次浏览');
    const backBtn = [...doc.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('返回教材首页'));
    await act(async () => backBtn!.click());
    expect(backs).toEqual([1]);
    const ch2 = doc.querySelector<HTMLButtonElement>('button[aria-label="学习章节：第二课超长标题超长标题超长标题超长标题"]');
    expect(ch2).toBeDefined();
    await act(async () => ch2!.click());
    expect(selects).toEqual(['a-c2']);
  } finally { dom.teardown(); }
}, 15000);
