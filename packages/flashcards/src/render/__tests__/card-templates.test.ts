import { describe, expect, it } from 'bun:test';
import {
  BUILTIN_CARD_FORMATS,
  buildCardContext,
  escapeHtml,
  extractCardFields,
  extractFieldMarkers,
  getBuiltinCardFormat,
  guessFieldMapping,
  analyzeTemplateCompat,
  renderCard,
  renderCardTemplate,
  renderFieldTemplate,
  validateCardFormat,
  validateCardTemplate,
  validateFieldTemplate,
  type CardContext,
} from '../index.js';

const SAMPLE: CardContext = {
  expression: '食べる',
  reading: 'たべる',
  glossary: '<div>to eat</div>',
  sentence: 'ご飯を食べる。',
  pitchAccent: '⓪',
  frequency: 123,
  tags: ['jlpt-n5'],
};

describe('card field templates {marker}', () => {
  it('替换白名单标记；未知标记原样保留', () => {
    expect(renderFieldTemplate('{expression}（{reading}）', SAMPLE)).toBe('食べる（たべる）');
    expect(renderFieldTemplate('{glossary}', SAMPLE)).toBe('<div>to eat</div>');
    expect(renderFieldTemplate('{pitch-accent} {frequency}', SAMPLE)).toBe('⓪ #123');
    expect(renderFieldTemplate('{unknown-thing}', SAMPLE)).toBe('{unknown-thing}');
  });

  it('缺失值渲染为空；纯文本转义防 XSS', () => {
    const bare: CardContext = { expression: '<script>alert(1)</script>', glossary: '<div>x</div>' };
    expect(renderFieldTemplate('{expression}|{reading}|{sentence}', bare)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;||'
    );
    // glossary 为预组装 HTML，原样输出
    expect(renderFieldTemplate('{glossary}', bare)).toBe('<div>x</div>');
  });

  it('校验上报未知标记', () => {
    expect(validateFieldTemplate('{expression}')).toEqual([]);
    const issues = validateFieldTemplate('{expression} {foobar}');
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('{foobar}');
  });

  it('extractFieldMarkers 去重', () => {
    expect(extractFieldMarkers('{expression}{expression}{reading}').sort()).toEqual([
      'expression',
      'reading',
    ]);
  });
});

describe('card templates {{Field}} (Anki subset v1)', () => {
  it('字段/FrontSide/条件块/反向条件', () => {
    const fields = { Expression: '食べる', Reading: '', Meaning: '<div>to eat</div>' };
    expect(renderCardTemplate('<div>{{Expression}}</div>', fields)).toBe('<div>食べる</div>');
    expect(
      renderCardTemplate('{{#Reading}}R{{/Reading}}{{^Reading}}no-R{{/Reading}}', fields)
    ).toBe('no-R');
    expect(renderCardTemplate('{{FrontSide}}<hr>{{Meaning}}', fields, 'FRONT')).toBe(
      'FRONT<hr><div>to eat</div>'
    );
  });

  it('未知字段按 Anki 语义置空', () => {
    expect(renderCardTemplate('[{{Missing}}]', {})).toBe('[]');
  });

  it('校验：未闭合条件块与超集过滤器', () => {
    expect(validateCardTemplate('{{Expression}}')).toEqual([]);
    expect(validateCardTemplate('{{#Reading}}x').length).toBe(1);
    // S4 已支持 cloze/hint/text；type: 答案输入仍拒绝
    expect(validateCardTemplate('{{cloze:Text}}{{hint:Meaning}}')).toEqual([]);
    const filter = validateCardTemplate('{{type:Answer}}');
    expect(filter.length).toBe(1);
    expect(filter[0]).toContain('type');
  });

  it('extractCardFields 含条件块内外字段名', () => {
    expect(
      extractCardFields('{{Expression}}{{#Reading}}r{{/Reading}}{{FrontSide}}').sort()
    ).toEqual(['Expression', 'FrontSide', 'Reading']);
  });
});

describe('buildCardContext + renderCard end-to-end', () => {
  it('条目组装上下文并渲染内置模板', () => {
    const ctx = buildCardContext({
      headword: '食べる',
      reading: 'たべる',
      meanings: ['to eat', 'to live'],
      pitchLabel: '⓪',
      pitchPositions: [0],
      frequency: 123,
      sentence: 'ご飯を食べる。',
    });
    expect(ctx.pitchGraph).toContain('<svg');
    const builtin = getBuiltinCardFormat('study-basic');
    expect(builtin).toBeDefined();
    const rendered = renderCard(builtin!, ctx);
    expect(rendered.fields['Expression']).toBe('食べる');
    expect(rendered.frontHtml).toContain('食べる');
    expect(rendered.backHtml).toContain('たべる');
    expect(rendered.backHtml).toContain('to eat');
    expect(rendered.backHtml).toContain('⓪');
    expect(rendered.backHtml).toContain('<svg');
    expect(rendered.backHtml).toContain('ご飯を食べる。');
  });

  it('空释义不编造：回退词面', () => {
    const ctx = buildCardContext({ headword: 'xyz', meanings: [] });
    expect(ctx.glossary).toContain('xyz');
  });

  it('escapeHtml 全覆盖', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('validateCardFormat', () => {  it('内置模板通过校验', () => {
    expect(validateCardFormat(BUILTIN_CARD_FORMATS[0]!)).toEqual([]);
  });

  it('空字段/未知标记/空正面逐条上报', () => {
    const bad = {
      ...BUILTIN_CARD_FORMATS[0]!,
      fields: { Expression: '{nope}' },
      frontTemplate: '{{Missing}}',
    };
    const issues = validateCardFormat(bad);
    expect(issues.some((i) => i.includes('{nope}'))).toBe(true);
    expect(issues.some((i) => i.includes('正面模板渲染为空'))).toBe(true);
  });

  it('getBuiltinCardFormat 未知 id 返回 undefined（读侧永不抛）', () => {
    expect(getBuiltinCardFormat('no-such-format')).toBeUndefined();
  });
});

describe('guessFieldMapping (网上模板字段映射推测)', () => {
  it('常见字段名命中；猜不出返回 null', () => {
    const mapping = guessFieldMapping(['Word', 'Meaning', 'Example', 'Sound', 'Something_Weird']);
    expect(mapping['Word']).toBe('expression');
    expect(mapping['Meaning']).toBe('glossary');
    expect(mapping['Example']).toBe('sentence');
    expect(mapping['Sound']).toBe('audio');
    expect(mapping['Something_Weird']).toBeNull();
  });

  it('归一化（大小写/空格/下划线）', () => {
    const mapping = guessFieldMapping([' front ', 'Yomi', 'CHINESE MEANING']);
    expect(mapping[' front ']).toBe('expression');
    expect(mapping['Yomi']).toBe('reading');
    expect(mapping['CHINESE MEANING']).toBe('glossary');
  });
});

describe('analyzeTemplateCompat (网上模板兼容性分析)', () => {  it('干净模板无提示', () => {
    expect(analyzeTemplateCompat('{{Expression}}', '{{FrontSide}}{{Meaning}}', '.card {}')).toEqual([]);
  });

  it('脚本/特殊占位/内联样式/空 CSS 逐条提示', () => {
    const issues = analyzeTemplateCompat(
      '{{Expression}}<script>alert(1)</script>',
      '{{FrontSide}}{{Tags}}{{cloze:Text}}<style>.x{}</style>',
      ''
    );
    expect(issues.some((i) => i.includes('<script>'))).toBe(true);
    // Tags 已支持不再警告；cloze/text/hint 已支持不再警告
    expect(issues.some((i) => i.includes('{{Tags}}'))).toBe(false);
    expect(issues.some((i) => i.includes('cloze'))).toBe(false);
    expect(issues.some((i) => i.includes('<style>'))).toBe(true);
    expect(issues.some((i) => i.includes('CSS'))).toBe(true);
  });

  it('{{Card}}/{{Type}} 仍提示置空；{{type:}} 输入判分仍拒绝', () => {
    const issues = analyzeTemplateCompat('{{Card}}', '{{Type}}{{type:Answer}}', '.card{}');
    expect(issues.some((i) => i.includes('{{Card}}'))).toBe(true);
    expect(issues.some((i) => i.includes('type'))).toBe(true);
  });
});

describe('renderCardTemplate S4 compat (Tags/Deck/hint/text/cloze)', () => {
  it('Tags/Deck/Subdeck 与条件块', () => {
    const fields = { Expression: 'x' };
    const extra = { tags: ['n5', 'mine'], deckName: 'Japanese::N5' };
    expect(renderCardTemplate('{{Tags}}|{{Deck}}|{{Subdeck}}', fields, '', extra)).toBe(
      'n5 mine|Japanese::N5|N5'
    );
    expect(renderCardTemplate('{{#Tags}}has{{/Tags}}{{^Deck}}nodeck{{/Deck}}', fields, '', extra)).toBe('has');
    expect(renderCardTemplate('{{Tags}}', fields)).toBe('');
  });

  it('hint 折叠揭示；空值不输出', () => {
    const out = renderCardTemplate('{{hint:Meaning}}', { Meaning: '<div>to eat</div>' });
    expect(out).toContain('<details');
    expect(out).toContain('to eat');
    expect(renderCardTemplate('[{{hint:Missing}}]', {})).toBe('[]');
  });

  it('text 去标签；cloze 正面遮背面显', () => {
    expect(renderCardTemplate('{{text:Meaning}}', { Meaning: '<div>to <b>eat</b></div>' })).toBe('to eat');
    const front = renderCardTemplate('{{cloze:Text}}', { Text: 'I {{c1::like::prefer}} apples' }, '', { isFront: true });
    expect(front).toBe('I prefer apples');
    const frontHidden = renderCardTemplate('{{cloze:Text}}', { Text: 'I {{c1::like}} apples' }, '', { isFront: true });
    expect(frontHidden).toBe('I [...] apples');
    const back = renderCardTemplate('{{cloze:Text}}', { Text: 'I {{c1::like}} apples' }, 'FRONT', { isFront: false });
    expect(back).toBe('I like apples');
  });

  it('renderCard 自动透传 ctx tags/deckName', () => {
    const rendered = renderCard(
      {
        ...BUILTIN_CARD_FORMATS[0]!,
        frontTemplate: '{{Tags}}/{{Deck}}',
        backTemplate: '{{FrontSide}}',
      },
      { expression: 'x', glossary: '<div>y</div>', tags: ['t1'], deckName: 'D::S' }
    );
    expect(rendered.frontHtml).toBe('t1/D::S');
  });
});
