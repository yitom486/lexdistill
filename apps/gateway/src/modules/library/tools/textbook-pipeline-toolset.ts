import type { ToolDefinition } from '@study-studio/tool-core';
import type { ContentRepository } from '../ports.js';
import { LibrarySubmitTocTool } from './library-toc-tool.js';
import { LibraryLessonCommitTool } from './library-lesson-commit-tool.js';

/**
  * 专精教材处理智能体工具集定义（Textbook Pipeline Toolset）：
  * 包含两个核心工具：
  * 1. library_submit_toc: 目录识别、单调递增页码自动校验与槽位初始化；
  * 2. library_commit_lesson: 单课正文 Markdown、生词、语法例句、习题的原子提炼回填。
  *
  * 统一环境注入，避免为目录与课文提炼分别构造不同智能体环境，
  * 且与主聊天日常对话工具集保持隔离（符合 AGENTS.md §1.6b）。
  */
export function createTextbookPipelineTools(repo: ContentRepository): ToolDefinition<any, any>[] {
  return [
    new LibrarySubmitTocTool(repo),
    new LibraryLessonCommitTool(repo),
  ];
}
