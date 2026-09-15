import { describe, expect, test } from 'bun:test';
import {
  attachShutdownSignals,
  attachShutdownStdin,
  createShutdownCommandParser,
  createShutdownController,
} from '../bootstrap/shutdown-control.js';

describe('sidecar shutdown control', () => {
  test('parses fragmented exact shutdown command and CRLF', () => {
    const requests: number[] = [];
    const parser = createShutdownCommandParser(() => requests.push(1));

    parser.push('unknown\nshut');
    parser.push('down\r\nshutdown-now\n');

    expect(requests).toHaveLength(1);
  });

  test('ignores unknown and unterminated input', () => {
    const requests: number[] = [];
    const parser = createShutdownCommandParser(() => requests.push(1));

    parser.push('shutdown-now\n');
    parser.push('shutdown');

    expect(requests).toHaveLength(0);
  });

  test('attaches stdin without requiring a real process stream', () => {
    let onData: ((chunk: unknown) => void) | undefined;
    let requests = 0;
    attachShutdownStdin(
      {
        on(_event, listener) {
          onData = listener;
        },
      },
      () => {
        requests += 1;
      },
    );

    onData?.('shutdown\n');
    expect(requests).toBe(1);
  });

  test('shutdown controller is single-flight across duplicate requests', async () => {
    let stopCalls = 0;
    const exits: number[] = [];
    let releaseStop: (() => void) | undefined;
    const stop = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const controller = createShutdownController({
      stop: async () => {
        stopCalls += 1;
        await stop;
      },
      exit: (code) => exits.push(code),
    });

    controller.request('stdin');
    controller.request('SIGTERM');
    expect(controller.isRequested()).toBe(true);
    expect(stopCalls).toBe(1);

    releaseStop?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(exits).toEqual([0]);
  });

  test('signal adapter forwards both supported signals', () => {
    const handlers = new Map<string, () => void>();
    const reasons: string[] = [];
    attachShutdownSignals(
      {
        on(event, listener) {
          handlers.set(event, listener);
          return undefined;
        },
      },
      (reason) => reasons.push(reason),
    );

    handlers.get('SIGINT')?.();
    handlers.get('SIGTERM')?.();
    expect(reasons).toEqual(['SIGINT', 'SIGTERM']);
  });
});
