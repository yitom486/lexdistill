import type { SchemaMigration } from './types.js';

// P2 新题库作答闭环：主观题提交保留（待批改/已判分/批改失败），与客观题共用
// quiz_attempts/mistakes 事实表。v044-v046 已发布，只新增表，不改已有结构。
// 提交身份沿用客观入口的 att_<userlen>:<user>:<submissionId> 口径，同键换内容视为冲突。
const statements = [
  `CREATE TABLE bank_submissions (
    user_id TEXT NOT NULL, submission_id TEXT NOT NULL,
    task_id TEXT NOT NULL REFERENCES generation_tasks(id),
    paper_id TEXT NOT NULL REFERENCES bank_papers(id),
    question_id TEXT NOT NULL REFERENCES bank_questions(id),
    answer_type TEXT NOT NULL, user_answer TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('SUBMITTED','GRADED','GRADING_FAILED')),
    is_correct INTEGER CHECK(is_correct IS NULL OR is_correct IN (0,1)),
    score REAL CHECK(score IS NULL OR (score>=0 AND score<=1)),
    grading_json TEXT CHECK(grading_json IS NULL OR json_valid(grading_json)),
    grading_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,submission_id)
  )`,
  `CREATE INDEX bank_submissions_question ON bank_submissions(user_id,question_id,created_at)`,
];
export const migration: SchemaMigration = { version: 47, name: 'bank-answer-submissions', statements, sql: statements.join(';\n') + ';' };
