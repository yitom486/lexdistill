export type ShutdownReason = 'stdin' | 'SIGINT' | 'SIGTERM';

export interface ShutdownController {
  request(reason: ShutdownReason): void;
  isRequested(): boolean;
}

export interface ShutdownControllerOptions {
  stop: (closeActiveConnections: boolean) => void | Promise<void>;
  exit: (code: number) => void;
  reportError?: (error: unknown) => void;
}

/**
 * Creates the single-flight shutdown state machine used by both entrypoints.
 * The first request owns listener.stop and exit; later signals/commands are
 * deliberately ignored so shutdown cannot race itself.
 */
export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
  let requested = false;

  return {
    request(_reason) {
      if (requested) return;
      requested = true;
      void (async () => {
        try {
          await options.stop(true);
        } catch (error) {
          options.reportError?.(error);
        } finally {
          options.exit(0);
        }
      })();
    },
    isRequested() {
      return requested;
    },
  };
}

export interface ShutdownInput {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/**
 * Parses only the exact `shutdown` line. It is intentionally not a general
 * command channel: unknown input is ignored and a bounded buffer prevents a
 * malformed stream without newlines from growing forever.
 */
export function createShutdownCommandParser(onShutdown: () => void) {
  const MAX_BUFFER_LENGTH = 256;
  let buffer = '';

  return {
    push(chunk: unknown): void {
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? new TextDecoder().decode(chunk)
            : '';
      buffer += text;
      if (buffer.length > MAX_BUFFER_LENGTH) {
        buffer = buffer.slice(-MAX_BUFFER_LENGTH);
      }

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line === 'shutdown') onShutdown();
        newlineIndex = buffer.indexOf('\n');
      }
    },
  };
}

export function attachShutdownStdin(input: ShutdownInput, onShutdown: () => void): void {
  const parser = createShutdownCommandParser(onShutdown);
  input.on('data', (chunk) => parser.push(chunk));
}

export interface ShutdownSignalInput {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export function attachShutdownSignals(
  input: ShutdownSignalInput,
  onShutdown: (reason: Exclude<ShutdownReason, 'stdin'>) => void,
): void {
  input.on('SIGINT', () => onShutdown('SIGINT'));
  input.on('SIGTERM', () => onShutdown('SIGTERM'));
}
