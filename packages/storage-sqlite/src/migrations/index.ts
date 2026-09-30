import { migration as v002 } from './v002-encountered-terms.js';
import { migration as v003 } from './v003-card-drafts-reading-positions.js';
import { migration as v004 } from './v004-activity-alphabet-counts.js';
import { migration as v005 } from './v005-kana-learning-guides.js';
import { migration as v006 } from './v006-placement-exams.js';
import { migration as v007 } from './v007-flashcards-studied-at.js';
import { migration as v008 } from './v008-kana-practice-states.js';
import { migration as v009 } from './v009-card-drafts-kind.js';
import { migration as v010 } from './v010-term-examples.js';
import { migration as v011 } from './v011-curriculum-lessons.js';
import { migration as v012 } from './v012-unit-progress.js';
import { migration as v013 } from './v013-placement-blueprint.js';
import { migration as v014 } from './v014-textbook-shred.js';
import { migration as v015 } from './v015-document-structure.js';
import { migration as v016 } from './v016-textbook-exercises-grammar-examples.js';
import { migration as v017 } from './v017-lesson-sort-order.js';
import { migration as v018 } from './v018-seed-materialization-state.js';
import { migration as v019 } from './v019-toc-import-sessions.js';
import { migration as v020 } from './v020-toc-import-session-document.js';
import { migration as v021 } from './v021-toc-import-session-ast-fp.js';
import { migration as v022 } from './v022-review-schedule-events.js';
import { migration as v023 } from './v023-content-segments.js';
import { migration as v024 } from './v024-content-sources.js';
import { migration as v025 } from './v025-selection-contexts.js';
import { migration as v026 } from './v026-term-occurrence-segments.js';
import { migration as v027 } from './v027-encountered-term-counts.js';
import { migration as v028 } from './v028-ai-artifact-runs.js';
import { migration as v029 } from './v029-artifact-user.js';
import { migration as v030 } from './v030-knowledge-points.js';
import { migration as v031 } from './v031-textbook-slots-and-prune.js';
import { migration as v032 } from './v032-drop-toc-import-sessions.js';
import { migration as v033 } from './v033-textbook-lesson-pedagogy.js';
import { migration as v034 } from './v034-textbook-structured-content.js';
import { migration as v035 } from './v035-textbook-import-events.js';
import type { SchemaMigration } from './types.js';

export type { SchemaMigration } from './types.js';

/**
 * 已发布迁移目录（v2–v32）。v1 = runMigrations 写入的 legacy-baseline，无独立文件。
 * 新增：加 vNNN-name.ts，并按 version 登记到本数组末尾。禁止改既有条目。
 * `ddl.ts` 的 runMigrations 从此数组调度。
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  v002,
  v003,
  v004,
  v005,
  v006,
  v007,
  v008,
  v009,
  v010,
  v011,
  v012,
  v013,
  v014,
  v015,
  v016,
  v017,
  v018,
  v019,
  v020,
  v021,
  v022,
  v023,
  v024,
  v025,
  v026,
  v027,
  v028,
  v029,
  v030,
  v031,
  v032,
  v033,
  v034,
  v035,
];

