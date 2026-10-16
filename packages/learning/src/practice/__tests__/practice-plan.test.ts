import { describe, expect, it } from 'bun:test';
import { isOk, isErr } from '@lexdistill/shared';
import type { PracticeBlockSpec, PracticePlanTemplate } from '@lexdistill/protocol';
import {
  validateBlockSpec,
  validatePracticePlanTemplate,
  freezeRunFromTemplate,
  isRunComplete,
  isTemplateDueOn,
  parsePracticeBlockSpec,
  parsePracticeBlockSpecs,
  SUBJECTIVE_BATCH_MAX_COUNT,
} from '../index.js';

function baseBlock(overrides: Partial<PracticeBlockSpec> = {}): PracticeBlockSpec {
  return {
    id: 'b1',
    kind: 'QUIZ',
    count: 5,
    gradingMode: 'AUTO_IMMEDIATE',
    ...overrides,
  };
}

function baseTemplate(blocks: PracticeBlockSpec[]): PracticePlanTemplate {
  return {
    id: 'tpl_1',
    userId: 'u1',
    language: 'en',
    name: '晚间 35 分钟',
    enabled: true,
    revision: 1,
    blocks,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

describe('validateBlockSpec', () => {
  it('accepts a valid objective block', () => {
    const res = validateBlockSpec(baseBlock());
    expect(isOk(res)).toBe(true);
  });

  it('rejects count out of range', () => {
    expect(isErr(validateBlockSpec(baseBlock({ count: 0 })))).toBe(true);
    expect(isErr(validateBlockSpec(baseBlock({ count: 31 })))).toBe(true);
  });

  it('rejects objective block with AI grading', () => {
    const res = validateBlockSpec(baseBlock({ gradingMode: 'AI_BATCH' }));
    expect(isErr(res)).toBe(true);
  });

  it('rejects subjective block with AUTO_IMMEDIATE', () => {
    const res = validateBlockSpec(
      baseBlock({ kind: 'TRANSLATION', gradingMode: 'AUTO_IMMEDIATE' })
    );
    expect(isErr(res)).toBe(true);
  });

  it('enforces subjective batch cap', () => {
    const ok = validateBlockSpec(
      baseBlock({
        kind: 'TRANSLATION',
        gradingMode: 'AI_BATCH',
        count: SUBJECTIVE_BATCH_MAX_COUNT,
      })
    );
    expect(isOk(ok)).toBe(true);
    const bad = validateBlockSpec(
      baseBlock({
        kind: 'TRANSLATION',
        gradingMode: 'AI_BATCH',
        count: SUBJECTIVE_BATCH_MAX_COUNT + 1,
      })
    );
    expect(isErr(bad)).toBe(true);
  });

  it('rejects vocabularySource on non-vocab block', () => {
    const res = validateBlockSpec(baseBlock({ vocabularySource: 'DUE_CARDS' }));
    expect(isErr(res)).toBe(true);
  });

  it('rejects translationDirection on non-translation block', () => {
    const res = validateBlockSpec(
      baseBlock({ translationDirection: { sourceLanguage: 'zh', targetLanguage: 'en' } })
    );
    expect(isErr(res)).toBe(true);
  });
});

describe('validatePracticePlanTemplate', () => {
  it('accepts a valid template', () => {
    const res = validatePracticePlanTemplate(baseTemplate([baseBlock({ id: 'b1' })]));
    expect(isOk(res)).toBe(true);
  });

  it('rejects empty blocks', () => {
    const res = validatePracticePlanTemplate(baseTemplate([]));
    expect(isErr(res)).toBe(true);
  });

  it('rejects duplicate block ids', () => {
    const res = validatePracticePlanTemplate(
      baseTemplate([baseBlock({ id: 'b1' }), baseBlock({ id: 'b1', count: 3 })])
    );
    expect(isErr(res)).toBe(true);
  });

  it('accepts daily and valid weekly schedules', () => {
    const daily: PracticePlanTemplate = {
      ...baseTemplate([baseBlock({ id: 'b1' })]),
      schedule: { kind: 'daily' },
    };
    expect(isOk(validatePracticePlanTemplate(daily))).toBe(true);
    const weekly: PracticePlanTemplate = {
      ...baseTemplate([baseBlock({ id: 'b1' })]),
      schedule: { kind: 'weekly', weekdays: [1, 3, 5] },
    };
    expect(isOk(validatePracticePlanTemplate(weekly))).toBe(true);
  });

  it('rejects invalid weekly schedules', () => {
    const cases: PracticePlanTemplate[] = [
      {
        ...baseTemplate([baseBlock({ id: 'b1' })]),
        schedule: { kind: 'weekly', weekdays: [] },
      },
      {
        ...baseTemplate([baseBlock({ id: 'b1' })]),
        schedule: { kind: 'weekly', weekdays: [1, 7] },
      },
      {
        ...baseTemplate([baseBlock({ id: 'b1' })]),
        schedule: { kind: 'weekly', weekdays: [1, 1] },
      },
    ];
    for (const tpl of cases) {
      expect(isErr(validatePracticePlanTemplate(tpl))).toBe(true);
    }
  });
});

describe('isTemplateDueOn (P6-1)', () => {
  // 2026-09-05 是周六；2026-09-07 是周一；2026-09-08 是周二
  it('treats missing or daily schedule as always due', () => {
    const noSchedule = baseTemplate([baseBlock({ id: 'b1' })]);
    expect(isTemplateDueOn(noSchedule, '2026-09-05')).toBe(true);
    expect(isTemplateDueOn(noSchedule, '2026-09-08')).toBe(true);
    const daily: PracticePlanTemplate = { ...noSchedule, schedule: { kind: 'daily' } };
    expect(isTemplateDueOn(daily, '2026-09-05')).toBe(true);
  });

  it('matches weekly schedule against the date weekday', () => {
    const weekly: PracticePlanTemplate = {
      ...baseTemplate([baseBlock({ id: 'b1' })]),
      schedule: { kind: 'weekly', weekdays: [1, 3, 5] },
    };
    expect(isTemplateDueOn(weekly, '2026-09-07')).toBe(true); // 周一
    expect(isTemplateDueOn(weekly, '2026-09-09')).toBe(true); // 周三
    expect(isTemplateDueOn(weekly, '2026-09-08')).toBe(false); // 周二
    expect(isTemplateDueOn(weekly, '2026-09-05')).toBe(false); // 周六
  });

  it('returns false for corrupt schedule or date instead of inventing', () => {
    const emptyWeek: PracticePlanTemplate = {
      ...baseTemplate([baseBlock({ id: 'b1' })]),
      schedule: { kind: 'weekly', weekdays: [] },
    };
    expect(isTemplateDueOn(emptyWeek, '2026-09-07')).toBe(false);
    const normal = baseTemplate([baseBlock({ id: 'b1' })]);
    expect(isTemplateDueOn(normal, 'not-a-date')).toBe(false);
    expect(isTemplateDueOn(normal, '2026-13-40')).toBe(false);
    expect(isTemplateDueOn(normal, '2026-02-30')).toBe(false);
    const weekly: PracticePlanTemplate = {
      ...normal,
      schedule: { kind: 'weekly', weekdays: [1] },
    };
    expect(isTemplateDueOn(weekly, '')).toBe(false);
  });
});

describe('freezeRunFromTemplate', () => {
  it('freezes a copy of blocks with revision', () => {
    const template = baseTemplate([
      baseBlock({ id: 'b1', skillIds: ['s1'] }),
      baseBlock({ id: 'b2', kind: 'TRANSLATION', gradingMode: 'AI_BATCH', count: 3 }),
    ]);
    const run = freezeRunFromTemplate({ template, runId: 'run_1' });
    expect(run.templateRevision).toBe(1);
    expect(run.templateId).toBe('tpl_1');
    expect(run.status).toBe('IN_PROGRESS');
    expect(run.blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    // 深拷贝：改模板不影响 run
    template.blocks[0]!.skillIds!.push('s2');
    expect(run.blocks[0]!.skillIds).toEqual(['s1']);
    // 改模板 revision 不影响已冻结 run
    template.revision = 2;
    expect(run.templateRevision).toBe(1);
  });
});

describe('isRunComplete', () => {
  it('returns true when all expected items submitted/graded', () => {
    const attempts = [
      { id: 'a1', runId: 'r1', blockId: 'b1', itemId: 'q1', status: 'GRADED' as const },
      { id: 'a2', runId: 'r1', blockId: 'b1', itemId: 'q2', status: 'SUBMITTED' as const },
    ];
    expect(isRunComplete(attempts, ['q1', 'q2'])).toBe(true);
  });

  it('returns false when any item pending or draft', () => {
    const attempts = [
      { id: 'a1', runId: 'r1', blockId: 'b1', itemId: 'q1', status: 'GRADED' as const },
      { id: 'a2', runId: 'r1', blockId: 'b1', itemId: 'q2', status: 'DRAFT' as const },
    ];
    expect(isRunComplete(attempts, ['q1', 'q2'])).toBe(false);
  });

  it('returns false for empty expected set', () => {
    expect(isRunComplete([], [])).toBe(false);
  });
});

describe('parsePracticeBlockSpec', () => {
  it('parses a full block', () => {
    const raw = {
      id: 'b1',
      kind: 'TRANSLATION',
      count: 3,
      gradingMode: 'AI_BATCH',
      translationDirection: { sourceLanguage: 'zh', targetLanguage: 'en' },
      skillIds: ['s1'],
    };
    const b = parsePracticeBlockSpec(raw);
    expect(b?.kind).toBe('TRANSLATION');
    expect(b?.translationDirection?.targetLanguage).toBe('en');
  });

  it('rejects corrupt input', () => {
    expect(parsePracticeBlockSpec(null)).toBeNull();
    expect(parsePracticeBlockSpec({ id: 'x' })).toBeNull();
    expect(parsePracticeBlockSpec({ id: 'x', kind: 'BOGUS', count: 1, gradingMode: 'AUTO_IMMEDIATE' })).toBeNull();
  });

  it('parsePracticeBlockSpecs rejects empty or corrupt arrays', () => {
    expect(parsePracticeBlockSpecs([])).toBeNull();
    expect(parsePracticeBlockSpecs([{ id: 'x' }])).toBeNull();
    const ok = parsePracticeBlockSpecs([
      { id: 'b1', kind: 'QUIZ', count: 1, gradingMode: 'AUTO_IMMEDIATE' },
    ]);
    expect(ok?.[0]?.id).toBe('b1');
  });
});
