import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

/** Use Git Bash on Windows, never the unrelated System32 WSL launcher. */
export function bashExecutable(): string {
  if (process.platform !== 'win32') return '/bin/bash';
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, 'Git', 'bin', 'bash.exe');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('These shell fixtures require Git Bash on Windows. Install Git for Windows.');
}

/** File arguments and shell-owned environment paths must use MSYS drive syntax. */
export function bashPath(value: string): string {
  if (process.platform !== 'win32') return value;
  return value
    .replace(/\\/g, '/')
    .replace(/^([a-z]):/i, (_, drive: string) => `/${drive.toLowerCase()}`);
}

export function bashFixtureEnv(): NodeJS.ProcessEnv {
  // Windows can expose Path rather than PATH. Never send both to a child process.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(path|bash_env|env)$/i.test(key)),
  );
  const originalPath = Object.entries(process.env).find(([key]) => /^path$/i.test(key))?.[1] ?? '';
  const bin = dirname(bashExecutable());
  env.PATH = [bin, join(bin, '../usr/bin'), originalPath].join(delimiter);
  return env;
}
