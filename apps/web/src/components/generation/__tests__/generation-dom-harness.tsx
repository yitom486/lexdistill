import * as React from 'react';
import { expect } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Hono } from 'hono';
import type { AgentAdapter, AgentEvent, AgentSession, CreateSessionOptions } from '@lexdistill/agent-runtime';
import type { ExternalToolExecutor } from '@lexdistill/agent-runtime';
import { BusinessError, isOk, ok, err, type Result } from '@lexdistill/shared';
import { ToolRegistry } from '@lexdistill/tool-core';
import type { BankPaperReceipt, BankSubmitReceipt } from '@lexdistill/protocol';
import { DrizzleLearnerRepository } from '../../../../../gateway/src/infrastructure/drizzle-learner-repository.js';
import { SqliteQuestionGenerationRepository } from '../../../../../../packages/storage-sqlite/src/adapters/practice/question-generation-repository.js';
import { GenerationTaskService } from '../../../../../gateway/src/modules/question-generation/service.js';
import { GenerationRunManager } from '../../../../../gateway/src/modules/question-generation/run-manager.js';
import { createGenerationRoutes } from '../../../../../gateway/src/modules/question-generation/http/generation-routes.js';
import { createBankGradingRoutes } from '../../../../../gateway/src/modules/practice/http/bank-grading-routes.js';
import { GatewayServer } from '../../../../../gateway/src/runtime/gateway-runtime.js';
import type { GatewayDeps } from '../../../../../gateway/src/composition/gateway-deps.js';
import { act, setupDom } from '../../toc/__tests__/dom-setup.js';

export type Script = (call: ExternalToolExecutor, ctx: { sessionId: string; userId: string }) => Promise<string>;

export class FakeSession implements AgentSession {
  readonly threadId = 'fake-acp';
  private readonly abort = new AbortController();
  constructor(readonly sessionId: string, readonly userId: string,
    private readonly registry: ToolRegistry, private readonly clones: string[],
    private readonly script: Script) {}
  private resolveClone(name: string): string {
    const found = this.clones.find(n => n === name || n.startsWith(`${name}.`));
    if (!found) throw new Error(`clone missing for ${name}`);
    return found;
  }
  async *send(input: { message: string }): AsyncIterable<AgentEvent> {
    try {
      const registry = this.registry;
      const resolveClone = (name: string) => this.resolveClone(name);
      const call: ExternalToolExecutor = async (name, args, ctx) => {
        const res = await registry.execute(resolveClone(name), args, { userId: ctx.userId, sessionId: 'gateway-session' });
        if (!res.ok) throw res.error;
        return res.value;
      };
      const out = await this.script(call, { sessionId: this.sessionId, userId: this.userId });
      void input;
      yield { type: 'COMPLETED', finalOutput: out };
    } catch (raw) {
      yield { type: 'ERROR', error: raw instanceof BusinessError ? raw : new BusinessError('E_X', 'x', 'TOOL_EXECUTION') };
    }
  }
  async submitToolResult(): Promise<Result<void, BusinessError>> { return ok(undefined); }
  async submitApproval(): Promise<Result<void, BusinessError>> { return ok(undefined); }
  async steer(): Promise<Result<void, BusinessError>> { return ok(undefined); }
  async interrupt(): Promise<Result<void, BusinessError>> { this.abort.abort(); return ok(undefined); }
  async close(): Promise<Result<void, BusinessError>> { this.abort.abort(); return ok(undefined); }
}

function draft(category: string, extra: Record<string, unknown>) {
  return { category, targetLevel: 'A1', difficultyTier: 1, difficultyReason: 'Basic everyday words.',
    prompt: 'Prompt', explanation: 'Because.', skillIds: ['en.grammar.present'], citations: [], ...extra };
}

function indexed(base: Record<string, unknown>, index: number): Record<string, unknown> {
  if (index === 0) return base;
  const prompt = typeof base['prompt'] === 'string' ? `${base['prompt']} (${index + 1})` : base['prompt'];
  return { ...base, prompt };
}

/** 按冻结蓝图生成题目：题型/数量/听力形式与蓝图一致，综合预设输出与旧固定脚本相同。 */
function draftsFor(category: string, mode: string | null, index: number): Record<string, unknown> {
  if (category === 'GRAMMAR') return indexed(draft('GRAMMAR', { prompt: 'She ___ a student.',
    answer: { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'is' }, { key: 'B', text: 'are' }], correctKey: 'A' } }), index);
  if (category === 'CLOZE') return indexed(draft('CLOZE', { prompt: 'Fill the blank.',
    material: { type: 'READING', title: 'School', text: 'She ___ a student.' },
    answer: { type: 'FILL_BLANK', acceptedAnswers: ['is'] } }), index);
  if (category === 'READING') return indexed(draft('READING', { prompt: 'Put the sentence in order.',
    material: { type: 'READING', title: 'School', text: 'She is a student.' },
    answer: { type: 'REORDER', chunks: ['She', 'is', 'a student.'], correctOrder: [0, 1, 2] } }), index);
  if (category === 'LISTENING' && mode === 'DIALOGUE') return indexed(draft('LISTENING', { prompt: 'What greeting?',
    material: { type: 'LISTENING', title: 'Greeting', mode: 'DIALOGUE',
      turns: [{ speaker: 'MALE', text: 'Hello.' }, { speaker: 'FEMALE', text: 'Good morning.' }] },
    answer: { type: 'MULTIPLE_CHOICE', options: [{ key: 'A', text: 'Hello.' }, { key: 'B', text: 'Goodbye.' }], correctKey: 'A' } }), index);
  if (category === 'LISTENING' && mode === 'PASSAGE') return indexed(draft('LISTENING', { prompt: 'What did you hear?',
    material: { type: 'LISTENING', title: 'Passage', mode: 'PASSAGE', turns: [{ speaker: 'NARRATOR', text: 'Hello world.' }] },
    answer: { type: 'SHORT_ANSWER', referenceAnswer: 'Hello world.', rubric: 'Recognizes the phrase.' } }), index);
  if (category === 'LISTENING') return indexed(draft('LISTENING', { prompt: 'What is the news?',
    material: { type: 'LISTENING', title: 'News', mode: 'NEWS', turns: [{ speaker: 'NARRATOR', text: 'Good news.' }],
      news: { kind: 'SIMULATED' } },
    answer: { type: 'SHORT_ANSWER', referenceAnswer: 'Good news.', rubric: 'Recognizes the news.' } }), index);
  if (category === 'VOCABULARY') return indexed(draft('VOCABULARY', { prompt: 'Translate hello.',
    answer: { type: 'TRANSLATION', referenceAnswer: 'hello', rubric: 'Correct greeting.', targetLanguage: 'en' } }), index);
  return indexed(draft('WRITING', { prompt: 'Introduce yourself.',
    answer: { type: 'WRITING', sampleAnswer: 'I am a student.', rubric: 'Clear simple sentences.', minWords: 3, maxWords: 30 } }), index);
}

const CATEGORY_ORDER = ['GRAMMAR', 'CLOZE', 'READING', 'LISTENING', 'VOCABULARY', 'WRITING'] as const;
const MODE_ORDER = ['DIALOGUE', 'PASSAGE', 'NEWS'] as const;

/** 受控模型：先读冻结配置（含精确蓝图），按类别/听力形式精确生成，再合成音频组卷。 */
export async function happyScript(call: ExternalToolExecutor, ctx: { sessionId: string; userId: string }): Promise<string> {
  const withCtx = { sessionId: ctx.sessionId, userId: ctx.userId };
  const snapshot = await call('generation.config', {}, withCtx) as
    { blueprint: { categoryCounts: Record<string, number>; listeningModes?: Record<string, number> } | null };
  const counts = snapshot.blueprint?.categoryCounts ?? { GRAMMAR: 1, CLOZE: 1, READING: 1, LISTENING: 3, VOCABULARY: 1, WRITING: 1 };
  const modes = snapshot.blueprint?.listeningModes ?? { DIALOGUE: 1, PASSAGE: 1, NEWS: 1 };
  const questions: Record<string, unknown>[] = [];
  const listeningPositions: number[] = [];
  const modeCursor: Record<string, number> = {};
  for (const category of CATEGORY_ORDER) {
    const count = counts[category] ?? 0;
    for (let index = 0; index < count; index++) {
      let mode: string | null = null;
      if (category === 'LISTENING') {
        for (const candidate of MODE_ORDER) {
          const used = modeCursor[candidate] ?? 0;
          if (used < (modes[candidate] ?? 0)) { mode = candidate; modeCursor[candidate] = used + 1; break; }
        }
        mode ??= 'DIALOGUE';
        listeningPositions.push(questions.length);
      }
      questions.push(draftsFor(category, mode, index));
    }
  }
  const saved = await call('generation.submit', { requestKey: 'p3', questions }, withCtx) as BankSubmitReceipt;
  for (const [index, materialId] of saved.materialIds.entries()) {
    if (materialId && listeningPositions.includes(index)) await call('generation.audio', { materialId }, withCtx);
  }
  const paper = await call('generation.paper', { requestKey: 'p3paper', title: '综合练习', questionIds: saved.questionIds }, withCtx) as BankPaperReceipt;
  return paper.paperId;
}

export interface DomFlags { slowNext: boolean; failNext: boolean }

export interface DomHarness {
  doc: Document;
  repo: DrizzleLearnerRepository;
  userId: string;
  flags: DomFlags;
  audioFetches: string[];
  blobs: Blob[];
  played: string[];
  activities: Array<Record<string, unknown>>;
  settle: () => Promise<void>;
  waitFor: (ready: () => boolean) => Promise<void>;
  click: (text: string) => Promise<void>;
  cardFor: (snippet: string) => Element;
  clickIn: (card: Element, text: string) => Promise<void>;
  typeIn: (card: Element, label: string, value: string) => Promise<void>;
  /** 卸载后重挂（验证断开重开与任务列表重开）。 */
  remount: () => Promise<void>;
  setTrack: (track: 'ja' | 'en' | 'ko') => Promise<void>;
  failNextObjectivePost: () => void;
  setGradeMode: (mode: 'receipt' | 'error', score?: number) => void;
  answerPosts: Array<{ url: string; body: Record<string, unknown> }>;
  gradePosts: Array<{ url: string; body: Record<string, unknown> }>;
  resolvePosts: Array<{ url: string; body: Record<string, unknown> }>;
  gradeCalls: () => number;
  cleanup: () => Promise<void>;
}

/** 真实后端（Hono + Drizzle + 出题服务/调度）+ 受控模型 + 浏览器能力桩。 */
export async function bootDomBackend(): Promise<DomHarness> {
  const dom = await setupDom(true);
  const { GenerationWorkbench } = await import('../GenerationWorkbench.js');
  const { useUserProfileStore } = await import('../../../stores/useUserProfileStore.js');
  const { useTtsStore } = await import('../../../stores/useTtsStore.js');
  const originalProfile = useUserProfileStore.getState();
  const originalTts = useTtsStore.getState();
  const originalFetch = globalThis.fetch;
  const originalAudio = (globalThis as Record<string, unknown>)['Audio'];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const repo = new DrizzleLearnerRepository(':memory:');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const userId = 'p3_dom_user';
  const audioFetches: string[] = [];
  const blobs: Blob[] = [];
  const played: string[] = [];
  const activities: Array<Record<string, unknown>> = [];
  const answerPosts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const gradePosts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const resolvePosts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const flags: DomFlags = { slowNext: false, failNext: false };
  const gradeControl = { mode: 'receipt' as 'receipt' | 'error', score: 85, calls: 0 };
  let failObjectiveOnce = false;
  const failNextObjectivePost = () => { failObjectiveOnce = true; };
  const setGradeMode = (mode: 'receipt' | 'error', score = 85) => { gradeControl.mode = mode; gradeControl.score = score; };
  await repo.getLearnerProfile(userId);
  const bank = new SqliteQuestionGenerationRepository(repo.getRawDb());
  const service = new GenerationTaskService({ repository: bank });
  const script: Script = async (call, ctx) => {
    if (flags.failNext) { flags.failNext = false; return 'nothing saved'; }
    if (flags.slowNext) { flags.slowNext = false; await new Promise(r => setTimeout(r, 800)); }
    return happyScript(call, ctx);
  };
  const gradeAdapter: AgentAdapter = {
    id: 'fake-grader', name: 'fake-grader',
    async createSession(options: CreateSessionOptions): Promise<Result<AgentSession, BusinessError>> {
      gradeControl.calls++;
      const session: AgentSession = {
        sessionId: options.sessionId,
        send: async function* (input): AsyncIterable<AgentEvent> {
          gradeControl.calls++;
          if (gradeControl.mode === 'error') {
            yield { type: 'ERROR', error: new BusinessError('E_TEST_MODEL', 'Controlled failure', 'AGENT_RUNTIME') };
            return;
          }
          const tool = options.tools![0]!;
          const result = await tool.execute(
            { score: gradeControl.score, feedback: 'Controlled feedback', suggestions: [] },
            { userId: options.userId, sessionId: options.sessionId, turnId: 'grade-turn' });
          if (!isOk(result)) throw result.error;
          yield { type: 'COMPLETED' };
        },
        submitToolResult: async () => ok(undefined),
        submitApproval: async () => ok(undefined),
        steer: async () => ok(undefined),
        interrupt: async () => ok(undefined),
        close: async () => ok(undefined),
      };
      return ok(session);
    },
    async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
      return err(new BusinessError('E_X', 'x', 'VALIDATION'));
    },
  };
  const server = new GatewayServer(repo, gradeAdapter as unknown as AgentAdapter);
  const toolRegistry = new ToolRegistry();
  const runs = new GenerationRunManager({ service, repository: bank,
    resolveRunAdapter: () => ({
      adapter: {
        id: 'fake', name: 'fake',
        async createSession(options: CreateSessionOptions): Promise<Result<AgentSession, BusinessError>> {
          const clones = (options.tools ?? []).map(tool => tool.name);
          return ok(new FakeSession(options.sessionId, options.userId, toolRegistry, clones, script));
        },
        async resumeSession(): Promise<Result<AgentSession, BusinessError>> {
          return err(new BusinessError('E_X', 'x', 'VALIDATION'));
        },
      } as unknown as AgentAdapter,
      acp: true,
    }),
    toolRegistry,
    resolveAudio: () => ({ async render({ material }: { material: { mode: string } }) {
      return material.mode === 'PASSAGE'
        ? { bytes: new Uint8Array(48), mimeType: 'audio/L16;codec=pcm;rate=24000' }
        : { bytes: new Uint8Array([7, 7]), mimeType: 'audio/wav' };
    } }),
  });
  const app = new Hono()
    // 创建时模型证伪桩：不断言探针语义（探针由网关单测覆盖），只放行本脚手架的 test-model。
    .route('/', createGenerationRoutes({ repo, generation: { service, runs },
      server: { checkRunModelEffort: async () => ({ dropModel: false, warnings: [] }) } } as unknown as GatewayDeps))
    .route('/', createBankGradingRoutes({ repo, server, port: 0 } as unknown as GatewayDeps))
    .get('/api/agent/runtimes', c => c.json({ runtimes: [
      { id: 'codex-acp', label: 'ChatGPT', hint: '', configured: true,
        capabilities: { supportsModelPicker: false, supportsEffort: false, supportsThreads: false, supportsUsage: false, supportsHistory: true, supportsSessionTools: true } },
    ] }))
    .get('/api/agent/runtimes/:id/options', c => c.json({ models: [{ value: 'test-model', label: 'Test' }], efforts: [] }))
    .post('/api/task/activity/:userId', async c => {
      activities.push(await c.req.json().catch(() => ({})));
      return c.json({});
    });
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.includes('/api/generation/') || url.includes('/api/agent/runtimes') || url.includes('/api/task/activity/')) {
      if (url.includes('/audio/')) audioFetches.push(url);
      if (url.includes('/answers/') && (init?.method ?? 'GET') === 'POST' && !url.includes('/grade')) {
        answerPosts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
        if (failObjectiveOnce && url.includes('/answers/objective')) {
          failObjectiveOnce = false;
          const committed = await app.request(new Request(input, init));
          expect(committed.ok).toBe(true);
          throw new Error('Simulated lost response after commit');
        }
      }
      if (url.includes('/grade') && (init?.method ?? 'GET') === 'POST') {
        gradePosts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      }
      if (url.includes('/presets/resolve') && (init?.method ?? 'GET') === 'POST') {
        resolvePosts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      }
      return app.request(new Request(input, init));
    }
    return Response.json({});
  }, { preconnect: originalFetch.preconnect });
  (globalThis as Record<string, unknown>)['Audio'] = class {
    src = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null;
    constructor(src?: string) { if (src) this.src = src; }
    async play() { played.push(this.src); this.onended?.(); }
    pause() {}
  };
  URL.createObjectURL = ((blob: Blob) => { blobs.push(blob); return `blob:mock-${blobs.length}`; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  useUserProfileStore.setState({ profile: { ...originalProfile.profile, userId, targetLanguage: 'en' }, fetchProfile: async () => {} });
  useTtsStore.setState({ preferredService: 'test', modelId: 'voice-model', voiceIdMale: 'm', voiceIdFemale: 'f', rate: 1 });

  const doc = dom.dom.window.document;
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const waitFor = async (ready: () => boolean) => { for (let index = 0; index < 600 && !ready(); index++) await settle(); expect(ready()).toBe(true); };
  const click = async (text: string) => {
    const button = [...doc.querySelectorAll('button')].find(element =>
      element.textContent === text || element.getAttribute('aria-label') === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await settle();
  };
  const cardFor = (snippet: string): Element => {
    const card = [...doc.querySelectorAll('div[aria-label^="题目"]')].find(element => element.textContent?.includes(snippet));
    expect(card).toBeDefined();
    return card!;
  };
  const clickIn = async (card: Element, text: string) => {
    const button = [...card.querySelectorAll('button')].find(element =>
      element.textContent === text || element.getAttribute('aria-label') === text);
    expect(button).toBeDefined();
    await act(async () => (button as HTMLButtonElement).click());
    await settle();
  };
  const typeIn = async (card: Element, label: string, value: string) => {
    const field = [...card.querySelectorAll('input,textarea')].find(element => element.getAttribute('aria-label') === label) as HTMLInputElement | undefined;
    expect(field).toBeDefined();
    const win = dom.dom.window;
    await act(async () => {
      const prototype = field instanceof win.HTMLTextAreaElement
        ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
      field!.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
    await settle();
  };
  await act(async () => dom.root.render(
    <QueryClientProvider client={client}><GenerationWorkbench userId={userId} track="en" /></QueryClientProvider>));

  return {
    doc, repo, userId, flags, audioFetches, blobs, played, activities, settle, waitFor, click, cardFor, clickIn, typeIn,
    failNextObjectivePost, setGradeMode, answerPosts, gradePosts, resolvePosts, gradeCalls: () => gradeControl.calls,
    /** 卸载后重挂（验证断开重开与任务列表重开）。 */
    remount: async () => {
      const { GenerationWorkbench } = await import('../GenerationWorkbench.js');
      await act(async () => dom.root.render(<div />));
      await act(async () => dom.root.render(
        <QueryClientProvider client={client}><GenerationWorkbench userId={userId} track="en" /></QueryClientProvider>));
    },
    setTrack: async track => {
      await act(async () => dom.root.render(
        <QueryClientProvider client={client}><GenerationWorkbench userId={userId} track={track} /></QueryClientProvider>));
    },
    cleanup: async () => {
      await act(async () => dom.root.render(<div />));
      client.clear();
      repo.getRawDb().close();
      globalThis.fetch = originalFetch;
      (globalThis as Record<string, unknown>)['Audio'] = originalAudio;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      useUserProfileStore.setState(originalProfile);
      useTtsStore.setState(originalTts);
      dom.teardown();
    },
  };
}
