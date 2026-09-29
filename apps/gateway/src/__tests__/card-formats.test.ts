import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { narrowSaveCardFormatInput } from '@study-studio/storage-sqlite';
import { FlashcardsRenderTool } from '../modules/flashcards/tools/flashcards-render-tool.js';

let repo: DrizzleLearnerRepository;

beforeEach(() => {
  repo = new DrizzleLearnerRepository(':memory:');
});

const DRAFT = {
  id: 'custom-basic',
  name: '自定模板',
  fields: { Expression: '{expression}', Meaning: '{glossary}' },
  frontTemplate: '<div>{{Expression}}</div>',
  backTemplate: '{{FrontSide}}<hr>{{Meaning}}',
  css: '.card {}',
};

describe('card formats persistence', () => {
  it('list 懒播种内置模板', async () => {
    const res = await repo.listCardFormats();
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.some((f) => f.id === 'study-basic')).toBe(true);
    expect(res.value.find((f) => f.id === 'study-basic')?.userModified).toBe(false);
  });

  it('未改过的旧版行自动跟进内置；改过的行不动', async () => {
    const db = repo.getRawDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO anki_card_formats (id, name, entry_type, deck_name, model_name, fields_json, front_template, back_template, css, template_version, user_modified, updated_at)
       VALUES ('study-basic', '旧名', 'term', NULL, NULL, '{}', 'F', 'B', '', 1, 0, ?)`
    ).run(now);
    db.prepare(
      `INSERT INTO anki_card_formats (id, name, entry_type, deck_name, model_name, fields_json, front_template, back_template, css, template_version, user_modified, updated_at)
       VALUES ('my-own', '我的', 'term', NULL, NULL, '{"Expression":"{expression}"}', 'F', 'B', '', 1, 1, ?)`
    ).run(now);
    const res = await repo.listCardFormats();
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const builtin = res.value.find((f) => f.id === 'study-basic');
    expect(builtin?.templateVersion).toBe(4);
    expect(builtin?.name).toBe('Lingua Studio 基础');
    expect(builtin?.fields['Pitch']).toContain('{pitch-graph}');
    const mine = res.value.find((f) => f.id === 'my-own');
    expect(mine?.name).toBe('我的');
  });

  it('save 新建自定义模板并标 userModified；二次保存版本号递增', async () => {
    const narrowed = narrowSaveCardFormatInput(DRAFT);
    expect(narrowed).toBeDefined();
    const first = await repo.saveCardFormat(narrowed!);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.userModified).toBe(true);
    const second = await repo.saveCardFormat({ ...narrowed!, name: '自定模板 v2' });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.templateVersion).toBeGreaterThan(first.value.templateVersion);
    expect(second.value.name).toBe('自定模板 v2');
  });

  it('save 校验不通过拒绝写入（未知标记）', async () => {
    const bad = narrowSaveCardFormatInput({
      ...DRAFT,
      id: 'bad-format',
      fields: { Expression: '{nope}' },
    });
    expect(bad).toBeDefined();
    const res = await repo.saveCardFormat(bad!);
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
  });

  it('reset 恢复内置（用户修改被还原）；自定义模板拒绝恢复', async () => {
    const narrowed = narrowSaveCardFormatInput({
      id: 'study-basic',
      name: '被改过的名字',
      fields: { Expression: '{expression}' },
      frontTemplate: '<div>{{Expression}}</div>',
      backTemplate: '{{FrontSide}}',
      css: '.card {}',
    });
    const saved = await repo.saveCardFormat(narrowed!);
    expect(isOk(saved)).toBe(true);
    const reset = await repo.resetCardFormat('study-basic');
    expect(isOk(reset)).toBe(true);
    if (!isOk(reset)) return;
    expect(reset.value.name).toBe('Lingua Studio 基础');
    expect(reset.value.userModified).toBe(false);
    const customReset = await repo.resetCardFormat('custom-basic');
    expect(isOk(customReset)).toBe(false);
  });
});

describe('narrowSaveCardFormatInput', () => {
  it('拒绝垃圾输入（读侧永不抛）', () => {
    expect(narrowSaveCardFormatInput(null)).toBeUndefined();
    expect(narrowSaveCardFormatInput({})).toBeUndefined();
    expect(narrowSaveCardFormatInput({ ...DRAFT, id: 'BAD ID!' })).toBeUndefined();
    expect(narrowSaveCardFormatInput({ ...DRAFT, fields: {} })).toBeUndefined();
    expect(narrowSaveCardFormatInput({ ...DRAFT, frontTemplate: 'x'.repeat(20001) })).toBeUndefined();
  });
});

describe('previewCardFormat', () => {
  const entry = { headword: '食べる', reading: 'たべる', meanings: ['to eat'] };

  it('缺省用内置模板渲染', async () => {
    const res = await repo.previewCardFormat({ entry });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.format.id).toBe('study-basic');
    expect(res.value.rendered.frontHtml).toContain('食べる');
    expect(res.value.rendered.backHtml).toContain('to eat');
    expect(res.value.issues).toEqual([]);
  });

  it('声调核位置透传：Pitch 字段含阶梯图', async () => {
    const res = await repo.previewCardFormat({
      entry: { ...entry, pitchLabel: '⓪', pitchPositions: [0] },
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.rendered.fields['Pitch']).toContain('⓪');
    expect(res.value.rendered.fields['Pitch']).toContain('<svg');
  });

  it('inline 草稿只渲染不入库', async () => {
    const before = await repo.listCardFormats();
    const res = await repo.previewCardFormat({
      inlineFormat: {
        id: 'draft-only',
        name: '草稿',
        entryType: 'term',
        fields: { Expression: '{expression}' },
        frontTemplate: 'DRAFT:{{Expression}}',
        backTemplate: '{{FrontSide}}',
        css: '',
        templateVersion: 0,
        userModified: true,
      },
      entry,
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.rendered.frontHtml).toBe('DRAFT:食べる');
    const after = await repo.listCardFormats();
    if (!isOk(before) || !isOk(after)) return;
    expect(after.value.length).toBe(before.value.length);
  });

  it('未知模板 id 友好报错', async () => {
    const res = await repo.previewCardFormat({ formatId: 'no-such', entry });
    expect(isOk(res)).toBe(false);
  });
});

describe('FlashcardsRenderTool', () => {
  it('与 HTTP 预览同命令：AI 可调用渲染', async () => {
    const tool = new FlashcardsRenderTool(repo);
    expect(tool.name).toBe('flashcards.render');
    const res = await tool.execute(
      { entry: { headword: '食べる', reading: 'たべる', meanings: ['to eat'] } },
      { userId: 'test', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.rendered.frontHtml).toContain('食べる');
  });

  it('非法条目友好报错（不抛）', async () => {
    const tool = new FlashcardsRenderTool(repo);
    const res = await tool.execute(
      // zod 只在运行时约束长度；此处直测网关侧收窄（空 headword + 空 meanings）
      { entry: { headword: '', meanings: [] } },
      { userId: 'test', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
  });
});
