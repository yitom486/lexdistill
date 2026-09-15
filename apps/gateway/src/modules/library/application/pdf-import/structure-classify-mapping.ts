import type {
  HeadingCandidate as ProtocolHeadingCandidate,
  StructureClass as ProtocolStructureClass,
} from '@study-studio/protocol';
import type {
  HeadingCandidate as DomainHeadingCandidate,
  StructureClass as DomainStructureClass,
} from '../../domain/document-structure.js';

/** HTTP/WS protocol → library domain. Keep this mapping explicit at the application boundary. */
export function toDomainHeadingCandidate(
  candidate: ProtocolHeadingCandidate
): DomainHeadingCandidate {
  return { page: candidate.page, text: candidate.text };
}

export function toDomainHeadingCandidates(
  candidates: readonly ProtocolHeadingCandidate[]
): DomainHeadingCandidate[] {
  return candidates.map(toDomainHeadingCandidate);
}

/** library domain → HTTP/WS protocol. The protocol shape remains owned by packages/protocol. */
export function toProtocolStructureClass(
  structureClass: DomainStructureClass
): ProtocolStructureClass {
  return {
    text: structureClass.text,
    page: structureClass.page,
    kind: structureClass.kind,
    lessonNo: structureClass.lessonNo,
    skillId: structureClass.skillId,
  };
}

export function toProtocolStructureClasses(
  classes: readonly DomainStructureClass[]
): ProtocolStructureClass[] {
  return classes.map(toProtocolStructureClass);
}
