import type { ToolDefinition, ToolExecutionContext } from './tool.js';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 注销按次注册的工具（如批改按轮次实例）。返回是否命中。
   * 常驻工具禁止注销调用（调用方保证只注销自己注册的实例）。
   */
  public unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 统一执行工具，包含输入模式校验与异常翻译保护
   */
  public async execute(
    name: string,
    rawInput: unknown,
    context: ToolExecutionContext
  ): Promise<Result<unknown, BusinessError>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return err(
        new BusinessError(
          'E_TOOL_NOT_FOUND',
          `未找到指定工具 [${name}]，请确认工具名称是否正确。`,
          'TOOL_EXECUTION',
          false
        )
      );
    }

    // 1. Zod 结构校验
    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      return err(
        new BusinessError(
          'E_TOOL_ARGS_INVALID',
          `工具 [${name}] 的参数不符合规范：${parsed.error.message}`,
          'VALIDATION',
          false,
          parsed.error.format()
        )
      );
    }

    // 2. 执行与异常拦截
    try {
      const res = await tool.execute(parsed.data, context);
      return res;
    } catch (unexpected) {
      return err(translateToBusinessError(unexpected, `TOOL:${name}`));
    }
  }
}
