import type { AgentAdapter, AgentEvent, AgentInput, CreateSessionOptions, AgentSession } from '@study-studio/agent-runtime';
import { LessonSubmissionSchema, type LessonContent, type LessonSubmission } from '@study-studio/document-model';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import type { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import type { CommitLessonKnowledgeOutput } from '../ports.js';
import { PDFDocument } from 'pdf-lib';
import type { ChapterSource } from '@study-studio/document-model';

export async function fixturePdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) pdf.addPage();
  return pdf.save();
}
export function parsedText(text: string, pages: readonly number[]): ChapterSource {
  return { parser: 'mineru-cloud', blocks: pages.map(page => ({ id: `p${page}b0`, page, kind: 'TEXT', text })) };
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
export function submissionFromPrompt(message: string): LessonSubmission {
  const value = (key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(message)?.[1] ?? '';
  const tocLine = message.split('本章目录:\n')[1]?.split('\n')[0] ?? '[]';
  const raw: unknown = JSON.parse(tocLine);
  const ids = Array.isArray(raw) ? raw.map(item => typeof item === 'object' && item && 'id' in item && typeof item.id === 'string' ? item.id : '') : [];
  return LessonSubmissionSchema.parse({ documentId: value('documentId'), lessonId: value('lessonId'), assignmentId: value('assignmentId'), content: contentFor(ids) });
}
export interface ModelTurn {
  sessionId: string; input: AgentInput;
  submit: (raw: unknown) => Promise<Result<CommitLessonKnowledgeOutput, BusinessError>>;
}
export function pipelineModel(tool: LibraryLessonCommitTool, handle?: (turn: ModelTurn) => Promise<void>) {
  const created: CreateSessionOptions[] = [], inputs: Array<{ sessionId: string; input: AgentInput }> = [], closed: string[] = [], interrupted: string[] = [];
  const adapter: AgentAdapter = {
    id: 'controlled-tool-model', name: 'Integration model output',
    createSession: async options => {
      created.push(options);
      const session: AgentSession = {
        sessionId: options.sessionId, threadId: `thread:${options.sessionId}`,
        async *send(input): AsyncIterable<AgentEvent> {
          inputs.push({ sessionId: options.sessionId, input });
          const callId = `call:${inputs.length}`;
          const submit = (raw: unknown) => tool.execute(raw, { sessionId: options.sessionId, userId: options.userId, callId });
          if (handle) await handle({ sessionId: options.sessionId, input, submit });
          else {
            const candidate = submissionFromPrompt(input.message);
            yield { type: 'TOOL_CALL_REQUESTED', callId, toolName: tool.name.replaceAll('.', '_'), input: candidate };
            const result = await submit(candidate);
            yield { type: 'TOOL_CALL_COMPLETED', callId, result };
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
