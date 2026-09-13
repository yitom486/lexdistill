import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentImageAttachment } from '../../contracts/index.js';
import { BusinessError, err, ok, type Result } from '@study-studio/shared';
import type { CodexTurnInputItem } from './app-server-protocol.js';

/** 单轮图片附件上限（与目录 review 窗上限同量级；超限明确拒绝，不截断）。 */
export const MAX_PNG_ATTACHMENTS_PER_TURN = 8;

/** 单张 PNG 体积上限（fork 渲染总预算 32MB；单张超限即拒绝，不写盘）。 */
const MAX_PNG_BYTES_PER_ATTACHMENT = 32 * 1024 * 1024;

export interface MaterializedPngAttachments {
  /** 随机命名的临时文件绝对路径（仅本轮有效）。 */
  paths: string[];
  /** 无条件删除全部临时文件（幂等；失败静默吞掉，不记路径）。 */
  cleanup: () => Promise<void>;
}

/**
 * 内存 PNG → 受控 OS 临时文件（仅本 codex 适配器可做）。
 * - 随机命名（`lingua-img-<uuid>.png`），不含业务信息；
 * - 数量/体积先验后写，半截失败时已写文件一并清掉；
 * - 不记录路径、图片内容与任何业务信息到日志（本函数零日志）。
 */
export async function materializePngAttachments(
  attachments: AgentImageAttachment[]
): Promise<Result<MaterializedPngAttachments, BusinessError>> {
  if (attachments.length === 0 || attachments.length > MAX_PNG_ATTACHMENTS_PER_TURN) {
    return err(
      new BusinessError(
        'E_INVALID_INPUT',
        `图片附件须为 1..${MAX_PNG_ATTACHMENTS_PER_TURN} 张`,
        'VALIDATION'
      )
    );
  }
  const paths: string[] = [];
  const cleanup = async (): Promise<void> => {
    await Promise.allSettled(paths.map((p) => unlink(p)));
  };
  try {
    for (const attachment of attachments) {
      if (!(attachment.png instanceof Uint8Array) || attachment.png.length === 0) {
        throw new BusinessError('E_INVALID_INPUT', '图片附件为空或格式不正确', 'VALIDATION');
      }
      if (attachment.png.length > MAX_PNG_BYTES_PER_ATTACHMENT) {
        throw new BusinessError('E_INVALID_INPUT', '单张图片附件过大，已拒绝', 'VALIDATION');
      }
      const filePath = path.join(tmpdir(), `lingua-img-${randomUUID()}.png`);
      await writeFile(filePath, attachment.png);
      paths.push(filePath);
    }
  } catch (e) {
    await cleanup();
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_AGENT_RUNTIME', '图片附件准备失败，请重试', 'AGENT_RUNTIME', true));
  }
  return ok({ paths, cleanup });
}

/**
 * turn 输入组装（纯函数）：文本在前，图片按附件顺序紧随。
 * 无图片时输出与既有纯文本 turn 逐字一致。
 */
export function buildTurnInputItems(message: string, imagePaths: string[]): CodexTurnInputItem[] {
  const items: CodexTurnInputItem[] = [{ type: 'text', text: message }];
  for (const imagePath of imagePaths) {
    items.push({ type: 'localImage', path: imagePath });
  }
  return items;
}
