import { expect, it } from 'bun:test';
import { SqliteQuestionGenerationRepository } from '../../../../../../packages/storage-sqlite/src/adapters/practice/question-generation-repository.js';
import { bootDomBackend } from './generation-dom-harness.js';

it('P4 switches language cleanly and persists the adjusted comprehensive blueprint through the actual UI', async () => {
  if (process.env['LINGUA_P4_FIX_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--timeout', '60000', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_P4_FIX_DOM_CHILD: '1' }, stdout: 'ignore', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const h = await bootDomBackend();
  try {
    await h.waitFor(() => h.doc.body.textContent?.includes('Test') === true);
    await h.setTrack('ko');
    await h.waitFor(() => h.doc.querySelector('[aria-label="目标等级"]')?.textContent?.includes('TOPIK_1') === true);
    await h.waitFor(() => h.doc.body.textContent?.includes('语言 ko（当前学习轨道）') === true);
    await h.click('应用建议');
    expect(h.doc.querySelector('[aria-label="目标等级"]')?.textContent).toContain('TOPIK_1');
    await h.setTrack('en');
    await h.waitFor(() => h.doc.querySelector('[aria-label="目标等级"]')?.textContent?.includes('A1') === true);

    const { act } = await import('../../toc/__tests__/dom-setup.js');
    const win = h.doc.defaultView!;
    for (const [label, value] of [['题量 GRAMMAR', '3'], ['题量 LISTENING', '4'], ['听力 DIALOGUE', '2']]) {
      const field = h.doc.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
      expect(field).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(field, value);
        field.dispatchEvent(new win.Event('input', { bubbles: true }));
      });
      await h.settle();
    }
    expect(h.doc.body.textContent).toContain('最终试卷固定 11 题');
    await h.click('开始出题');
    await h.waitFor(() => h.doc.body.textContent?.includes('已完成') === true);
    const bank = new SqliteQuestionGenerationRepository(h.repo.getRawDb());
    const tasks = bank.listUserTasks(h.userId);
    expect(tasks).toHaveLength(1);
    const task = bank.describeTask(h.userId, tasks[0]!.taskId);
    expect(task.config).toMatchObject({ language: 'en', targetLevel: 'A1', maxQuestions: 11, maxAudio: 4 });
    expect(task.blueprint).toMatchObject({ totalItems: 11, categoryCounts: { GRAMMAR: 3, LISTENING: 4 },
      listeningModes: { DIALOGUE: 2, PASSAGE: 1, NEWS: 1 } });
    expect(task.papers[0]!.questionIds).toHaveLength(11);
    // 任务落库早于试卷渲染：等高负载下 UI 未画完会偶发 0，先等到 11 题出现再断言
    await h.waitFor(() => h.doc.querySelectorAll('div[aria-label^="题目"]').length === 11);
    expect(h.doc.querySelectorAll('div[aria-label^="题目"]')).toHaveLength(11);
    expect(h.gradeCalls()).toBe(0);
  } finally { await h.cleanup(); }
}, 60000);
