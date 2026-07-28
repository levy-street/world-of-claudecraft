import type { RuntimeMode } from './contract';

export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  if (value === undefined || value === '' || value === 'inline') return 'inline';
  if (value === 'instance-workers') {
    throw new RangeError(
      'MMO_RUNTIME_MODE instance-workers is not configured with a production transfer adapter',
    );
  }
  throw new RangeError(`unsupported MMO_RUNTIME_MODE: ${value}`);
}
