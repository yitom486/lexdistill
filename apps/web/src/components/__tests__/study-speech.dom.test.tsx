import { expect, it, mock } from 'bun:test';
import * as React from 'react';
import type { VocabularyEntry } from '@lexdistill/protocol';
import type { TtsStreamBody } from '../../lib/tts-stream.js';
import { act, setupDom } from '../toc/__tests__/dom-setup.js';

it('学习详情朗读使用既有语音设置，支持取消、换词、三语与失败恢复，不误停其他入口', async () => {
  if (process.env['LINGUA_STUDY_SPEECH_DOM_CHILD'] !== '1') {
    const child = Bun.spawn([process.execPath, 'test', '--path-ignore-patterns', '**/dist/**', import.meta.path], {
      env: { ...process.env, LINGUA_STUDY_SPEECH_DOM_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ exit, output: exit ? output : '' }).toEqual({ exit: 0, output: '' });
    return;
  }
  const errors: string[] = [];
  mock.module('sonner', () => ({ toast: { error: (message: string) => errors.push(message), warning: () => {} } }));
  const dom = await setupDom(true);
  const { WordStudyDetail } = await import('../WordStudyDetail.js');
  const { speechStudio } = await import('../../utils/audio.js');
  const { useTtsStore } = await import('../../stores/useTtsStore.js');
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: TtsStreamBody; signal: AbortSignal }> = [];
  let fail = false;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(new URL(String(input)).pathname).toBe('/api/tts-studio/tts/stream');
    const signal = init!.signal!;
    requests.push({ body: JSON.parse(String(init!.body)) as TtsStreamBody, signal });
    if (fail) return Response.json({ error: '语音服务暂时不可用，请稍后重试。', code: 'E_TTS_UPSTREAM', retryable: true }, { status: 503 });
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  }, { preconnect: originalFetch.preconnect });
  const tts = useTtsStore.getState();
  tts.setPreferredService('gemini');
  tts.setModelId('controlled-test-model');
  tts.setVoiceId('study-voice');
  tts.setVoiceIdMale('dialogue-male');
  tts.setRate(0.75);
  tts.setSaveAudioCache(false);
  const word: VocabularyEntry = {
    id: 'school-ja', word: '学校', reading: 'がっこう', language: 'ja', meaning: '学校', level: null, collected: false,
    sources: [{ documentId: 'book', chapterId: 'lesson', bookTitle: '教材', chapterTitle: '第一课', meaning: '学校',
      examples: [{ text: '学校へ行きます。', translation: '去学校。' }] }],
    learning: { explanation: '上学的地方。', scenarios: [{ title: '问路', dialogue: [{ speaker: '田中', text: '学校はどこですか。', translation: '学校在哪里？' }] }], source: 'AI' },
  };
  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  const waitFor = async (ready: () => boolean) => {
    for (let i = 0; i < 100 && !ready(); i++) await settle();
    expect(ready()).toBe(true);
  };
  const render = async (value: VocabularyEntry) => act(async () => dom.root.render(<WordStudyDetail word={value} />));
  const click = async (label: string) => {
    const button = doc.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    await settle();
  };
  try {
    await render(word);
    expect(requests).toHaveLength(0); // 展示词卡不会自动合成或产生费用。
    await click('朗读单词：学校');
    expect(requests.at(-1)!.body).toMatchObject({ text: 'がっこう', provider: 'gemini', model: 'controlled-test-model', voiceName: 'study-voice', speed: 0.75, languageCode: 'ja-JP' });
    expect(doc.querySelector('[aria-label="停止朗读单词：学校"]')?.getAttribute('aria-pressed')).toBe('true');
    await click('停止朗读单词：学校');
    expect(requests.at(-1)!.signal.aborted).toBe(true);
    expect(doc.querySelector('[aria-label="朗读单词：学校"]')).toBeTruthy();

    await click('朗读单词：学校');
    const wordRequest = requests.at(-1)!;
    await click('朗读例句：学校へ行きます。');
    expect(wordRequest.signal.aborted).toBe(true);
    expect(requests.at(-1)!.body.text).toBe('学校へ行きます。');
    expect(requests.at(-1)!.body.text).not.toContain('去学校');
    const exampleRequest = requests.at(-1)!;
    await click('朗读对话：学校はどこですか。');
    expect(exampleRequest.signal.aborted).toBe(true);
    expect(requests.at(-1)!.body).toMatchObject({ text: '学校はどこですか。', voiceName: 'dialogue-male', speed: 0.75 });
    const dialogueRequest = requests.at(-1)!;
    await render({ ...word, id: 'cat-ja', word: '猫', reading: 'ねこ', sources: [], learning: undefined });
    expect(dialogueRequest.signal.aborted).toBe(true); // 换词清掉上一词的合成。

    await click('朗读单词：猫');
    const ownRequest = requests.at(-1)!;
    let externalRequest: Promise<void>;
    await act(async () => { externalRequest = tts.speak('ねこ', { lang: 'JA' }); });
    await waitFor(() => requests.at(-1) !== ownRequest);
    expect(ownRequest.signal.aborted).toBe(true);
    expect(doc.querySelector('[aria-label="朗读单词：猫"]')?.getAttribute('aria-pressed')).toBe('false');
    const externalSignal = requests.at(-1)!.signal;
    await act(async () => dom.root.render(<div />));
    expect(externalSignal.aborted).toBe(false); // 相同文本的外部朗读也不能误停。
    await act(async () => tts.stop());
    await externalRequest!;

    for (const sample of [
      { id: 'hello-en', word: 'hello', reading: 'həˈləʊ', language: 'en' as const, tag: 'en-US' },
      { id: 'hello-ko', word: '안녕하세요', reading: 'annyeonghaseyo', language: 'ko' as const, tag: 'ko-KR' },
    ]) {
      await render({ ...word, ...sample, sources: [], learning: undefined });
      await click(`朗读单词：${sample.word}`);
      expect(requests.at(-1)!.body).toMatchObject({ text: sample.word, languageCode: sample.tag });
    }
    const lastRequest = requests.at(-1)!;
    await act(async () => dom.root.render(<div />));
    expect(lastRequest.signal.aborted).toBe(true); // 退出也会取消待合成请求。

    fail = true;
    await render(word);
    await click('朗读单词：学校');
    await waitFor(() => !speechStudio.getIsSpeaking());
    expect(errors).toEqual(['语音服务暂时不可用，请稍后重试。']);
    expect(doc.querySelector('[aria-label="朗读单词：学校"]')?.getAttribute('aria-pressed')).toBe('false');
    const count = requests.length;
    fail = false;
    await click('朗读单词：学校');
    expect(requests).toHaveLength(count + 1); // 失败后可手动重试，没有重试风暴。
  } finally {
    await act(async () => { dom.root.render(<div />); tts.stop(); });
    await settle();
    globalThis.fetch = originalFetch;
    dom.teardown();
  }
}, 30_000);
