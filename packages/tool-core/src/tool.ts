import type { z } from 'zod';
import type { Result, BusinessError } from '@lexdistill/shared';
import type { ToolLocation, ToolPermission } from './permissions.js';

export interface ToolExecutionContext {
  userId: string;
  sessionId: string;
  turnId?: string;
  callId?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly location: ToolLocation;
  readonly permission: ToolPermission;
  readonly schema: z.ZodType<TInput>;
  execute(
    input: TInput,
    context: ToolExecutionContext
  ): Promise<Result<TOutput, BusinessError>>;
}
