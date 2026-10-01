/**
 * 一条已发布的 schema 升级。version / name 一旦随发行进入用户库，禁止改号、改名、改 SQL。
 * 回滚靠新增更高 version 的前向修复，不靠删除本文件。
 */
export interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
  /** Statements executed individually inside the migration transaction; surfaces batch errors. */
  statements?: readonly string[];
}
