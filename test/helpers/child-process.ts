import {execFile as execFileCallback, type ExecFileOptionsWithStringEncoding} from 'node:child_process';
import {promisify} from 'node:util';

const execFile = promisify(execFileCallback);

// Deployment workers normally finish in seconds; this leaves generous CI headroom while bounding genuine hangs.
export const CHILD_PROCESS_TIMEOUT_MS = 180_000;

type ChildProcessOptions = Omit<ExecFileOptionsWithStringEncoding, 'encoding' | 'timeout' | 'killSignal'>;

export function runChildProcess(
  file: string,
  args: readonly string[],
  options: ChildProcessOptions = {},
): Promise<{stdout: string; stderr: string}> {
  return execFile(file, [...args], {
    ...options,
    encoding: 'utf8',
    timeout: CHILD_PROCESS_TIMEOUT_MS,
    killSignal: 'SIGTERM',
  });
}

export function runTsxWorker(
  script: string,
  args: readonly string[],
  options: ChildProcessOptions = {},
): Promise<{stdout: string; stderr: string}> {
  return runChildProcess(process.execPath, ['--import', 'tsx', script, ...args], options);
}
