import type { RuntimeMode } from './contract';

export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  if (value === undefined || value === '' || value === 'inline') return 'inline';
  if (value === 'instance-workers') return value;
  throw new RangeError(`unsupported MMO_RUNTIME_MODE: ${value}`);
}
