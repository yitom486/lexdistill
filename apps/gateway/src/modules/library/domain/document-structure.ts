/** 文档结构领域允许的分类。协议层的 zod schema 只负责线上的形状校验。 */
export const HEADING_KINDS = ['lesson', 'section', 'toc', 'noise'] as const;
export type HeadingKind = (typeof HEADING_KINDS)[number];

/** 领域只依赖接地所需的事实，不依赖 HTTP/WS 协议字段。 */
export interface HeadingCandidate {
  page: number;
  text: string;
}

export interface StructureClass {
  text: string;
  page: number;
  kind: HeadingKind;
  lessonNo: string | null;
  skillId: string | null;
}

export interface GroundedStructure {
  classes: StructureClass[];
  dropped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHeadingKind(value: unknown): value is HeadingKind {
  return typeof value === 'string' && (HEADING_KINDS as readonly string[]).includes(value);
}

/**
 * 将模型候选接地到真实标题。
 *
 * 这是领域规则而非协议校验：模型不能创造标题，分类 kind 必须属于领域集合，
 * skillId 只能引用当前会话允许的技能；不合规条目被丢弃或清空，永不臆造数据。
 */
export function groundStructureClassifications(
  items: unknown,
  candidates: readonly HeadingCandidate[],
  allowedSkillIds: ReadonlySet<string>
): GroundedStructure {
  const classes: StructureClass[] = [];
  let dropped = 0;
  const pageByText = new Map<string, number>();
  for (const candidate of candidates) {
    if (!pageByText.has(candidate.text)) pageByText.set(candidate.text, candidate.page);
  }

  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (!isRecord(item)) {
      dropped += 1;
      continue;
    }

    const text = typeof item.text === 'string' ? item.text : '';
    const page = pageByText.get(text);
    if (!text || page === undefined) {
      dropped += 1;
      continue;
    }

    if (!isHeadingKind(item.kind)) {
      dropped += 1;
      continue;
    }

    const lessonNo = typeof item.lessonNo === 'string' ? item.lessonNo.slice(0, 16) : null;
    const skillRaw = typeof item.skillId === 'string' ? item.skillId : null;
    if (skillRaw && allowedSkillIds.has(skillRaw) && skillRaw.length > 64) {
      dropped += 1;
      continue;
    }
    const skillId = skillRaw && allowedSkillIds.has(skillRaw) ? skillRaw : null;
    classes.push({ text, page, kind: item.kind, lessonNo, skillId });
  }

  return { classes, dropped };
}
