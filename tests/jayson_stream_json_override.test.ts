import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Regression for a real incident: the pnpm.overrides entry for stream-json@1 was
// briefly forced to ^3.5.0 (the GHSA-528h-pc64-c93x patched floor) without noticing
// that jayson@4.3.0 (the only consumer, pulled in via @solana/web3.js) declares
// stream-json@^1.9.1 and requires it through paths that only exist on the 1.x
// layout (stream-json/streamers/StreamValues, stream-json/utils/Verifier). An
// override past 1.x does not fix the advisory, it makes `require('jayson')` throw
// MODULE_NOT_FOUND, since those paths moved under stream-json's src/ in 3.x. See
// docs/security/dependency-audit-catalog.md, GHSA-528h-pc64-c93x, for why the fix
// is a compatible override plus a scoped audit exception rather than a major bump.
const require = createRequire(import.meta.url);

describe('jayson / stream-json version compatibility', () => {
  it('installs the stream-json major jayson itself declares (^1.x)', () => {
    const jaysonPkg = require('jayson/package.json') as { dependencies: Record<string, string> };
    const streamJsonPkg = require('stream-json/package.json') as { version: string };
    expect(jaysonPkg.dependencies['stream-json']).toMatch(/^\^1\./);
    expect(
      streamJsonPkg.version.startsWith('1.'),
      `installed stream-json@${streamJsonPkg.version} must stay on the 1.x line jayson ` +
        `declares (${jaysonPkg.dependencies['stream-json']}), or its stream-json requires break at load time`,
    ).toBe(true);
  });

  it('loads jayson without throwing MODULE_NOT_FOUND', () => {
    expect(() => require('jayson')).not.toThrow();
  });

  it('resolves the exact stream-json submodules jayson/lib/utils.js requires at load time', () => {
    expect(() => require.resolve('stream-json/streamers/StreamValues')).not.toThrow();
    expect(() => require.resolve('stream-json/utils/Verifier')).not.toThrow();
  });
});
