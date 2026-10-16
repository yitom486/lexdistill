import type { AgentAdapter, AgentEvent, AgentInput, CreateSessionOptions, AgentSession } from '@lexdistill/agent-runtime';
import type { LessonContent } from '@lexdistill/document-model';
import { BusinessError, err, ok, type Result } from '@lexdistill/shared';
import type { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { PDFDocument } from 'pdf-lib';

/** 受控模型的图片输入夹具，不代表真实书页。 */
export const fixturePng = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3cAAAAASUVORK5CYII=', 'base64'));

export async function fixturePdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) pdf.addPage();
  return pdf.save();
}

export function contentFor(tocIds: string[]): LessonContent {
  return {
    coverage: tocIds.map(tocId => ({ tocId, status: 'EXTRACTED' })),
    blocks: tocIds.map((tocId, index) => ({ id: `b${index}`, kind: index ? 'DIALOGUE' : 'PARAGRAPH', text: `整理后的正文 ${tocId}`, source: 'TEXTBOOK', tocId, ...(index ? { speaker: '甲' } : {}) })),
    vocabularies: [{ id: 'v1', surface: '学ぶ', reading: 'まなぶ', gloss: '学习', source: 'TEXTBOOK', tocId: tocIds[0]!, examples: [], fieldSources: { reading: 'TEXTBOOK', gloss: 'AI' } }],
    knowledgePoints: [{ id: 'g1', title: '知识点', source: 'TEXTBOOK', tocId: tocIds[0]!, textbookExplanation: '原书说明', aiExplanation: '模型补充说明', examples: [{ id: 'eg1', text: '追加例句', source: 'AI', tocId: tocIds[0]! }] }],
    exercises: [{ id: 'ex1', type: 'SHORT_ANSWER', prompt: '原书问题', source: 'TEXTBOOK', tocId: tocIds[0]!, knowledgePointIds: ['g1'], answer: { text: '补充答案' }, explanation: '补充解析', fieldSources: { answer: 'AI', explanation: 'AI' } }],
    preview: { keyPoints: ['知识点'], pitfalls: [], canDoGoal: '理解当前课' },
    summary: { goldenSentences: [], selfCheckQuestions: ['理解了吗'] },
  };
}
export function submissionFromPrompt(message: string) {
  const title = /^章节: (.+)$/m.exec(message)?.[1] ?? '当前章节';
  return { items: [{ text: `整理后的正文 ${title}` }] };
}
export interface ModelTurn {
  sessionId: string; turnId: string; input: AgentInput;
  submit: (raw: unknown, kind?: import('@lexdistill/document-model').TextbookContentKind) => Promise<Result<unknown, BusinessError>>;
}
export const requiredContent = {
  grammar: { items: [{ title: '方向表达', explanation: 'へ表示方向。', examples: [{ text: '学校へ行く。' }] }] },
  vocabulary: { items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }] },
  exercises: { items: [{ type: 'CHOICE', prompt: '方向助词？', options: ['へ', 'を'], answer: 'へ', difficultyTier: 1, difficultyReason: '单一助词识别' }] },
};
export async function submitRequired(submit: ModelTurn['submit'], already: readonly import('@lexdistill/document-model').TextbookContentKind[] = []) {
  for (const kind of Object.keys(requiredContent) as Array<keyof typeof requiredContent>) {
    if (already.includes(kind)) continue;
    const result = await submit(requiredContent[kind], kind); if (!result.ok) throw result.error;
  }
}
export function pipelineModel(tool: TextbookContentTools, handle?: (turn: ModelTurn) => Promise<void>) {
  const created: CreateSessionOptions[] = [], inputs: Array<{ sessionId: string; input: AgentInput }> = [], closed: string[] = [], interrupted: string[] = [];
  const adapter: AgentAdapter = {
    id: 'controlled-tool-model', name: 'Integration model output', supportsImageInput: () => true, supportsLocalFileInput: () => true,
    createSession: async options => {
      created.push(options);
      const session: AgentSession = {
        sessionId: options.sessionId, threadId: `thread:${options.sessionId}`,
        async *send(input): AsyncIterable<AgentEvent> {
          inputs.push({ sessionId: options.sessionId, input });
          const callId = `call:${inputs.length}`;
          const turnId = `turn:${inputs.length}`;
          let toolCalls = 0;
          const submit = (raw: unknown, kind: import('@lexdistill/document-model').TextbookContentKind = 'articles') => tool.tools.find(item => item.kind === kind)!.execute(raw, { sessionId: options.sessionId, userId: options.userId, callId: ++toolCalls === 1 ? callId : `${callId}:${toolCalls}`, turnId });
          if (handle) await handle({ sessionId: options.sessionId, turnId, input, submit });
          else {
            const candidate = submissionFromPrompt(input.message);
            yield { type: 'TOOL_CALL_REQUESTED', callId, toolName: 'library_articles', input: candidate };
            const result = await submit(candidate);
            yield { type: 'TOOL_CALL_COMPLETED', callId, result };
            await submitRequired(submit);
          }
          yield { type: 'COMPLETED' };
        },
        submitToolResult: async () => ok(undefined), submitApproval: async () => ok(undefined), steer: async () => ok(undefined),
        interrupt: async () => { interrupted.push(options.sessionId); return ok(undefined); },
        close: async () => { closed.push(options.sessionId); return ok(undefined); },
      };
      return ok(session);
    },
    resumeSession: async () => err(new BusinessError('E_NOT_FOUND', '测试不恢复外部会话', 'AGENT_RUNTIME')),
  };
  return { adapter, created, inputs, closed, interrupted };
}
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
