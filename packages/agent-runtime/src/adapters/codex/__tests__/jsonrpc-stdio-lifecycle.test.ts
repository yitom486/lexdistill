import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { JsonRpcStdioClient } from '../jsonrpc-stdio.js';

describe('JsonRpcStdioClient lifecycle', () => {
  it('waits for a controlled child process to exit before close resolves', async () => {
    const rpc = new JsonRpcStdioClient();
    const started = await rpc.start({
      command: process.execPath,
      args: ['-e', "process.stdin.on('end', () => process.exit(0)); process.stdin.resume()"],
    });

    expect(isOk(started)).toBe(true);
    expect(rpc.isConnected).toBe(true);

    const closed = await rpc.close();

    expect(isOk(closed)).toBe(true);
    expect(rpc.isConnected).toBe(false);
  }, 20_000);
});
