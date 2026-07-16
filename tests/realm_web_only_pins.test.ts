import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source pins for the web-only/p2w realm feature (realm_platform_guard.ts).
// These guard cross-file contracts a unit test cannot see from one module.

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('web-only realm directory filter', () => {
  it('both /api/realms arms shape through realmsVisibleToRequest (dual-arm rule)', () => {
    // The RouteDef handler (server/leaderboard.ts) and the retained legacy arm
    // (server/main.ts) must filter identically; each shapes through the one
    // shared function so the twins cannot drift.
    const routeDef = read('server/leaderboard.ts');
    const handler = routeDef.slice(routeDef.indexOf('async function realmsHandler'));
    expect(handler).toContain('realmsVisibleToRequest(ctx.req, REALM_DIRECTORY)');

    const legacy = read('server/main.ts');
    const arm = legacy.slice(legacy.indexOf("url === '/api/realms'"));
    expect(arm).toContain('realmsVisibleToRequest(req, REALM_DIRECTORY)');
  });

  it('the client realm fetch sites filter through visibleRealms for app shells', () => {
    const main = read('src/main.ts');
    // Three fetch sites: enterRealmFlow, the showRealmList fallback fetch, and
    // the inline character-select realm dropdown.
    const count = main.split('visibleRealms(').length - 1;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

describe('characters never change realm', () => {
  it('no server SQL UPDATE on characters assigns the realm column', () => {
    // The one-way realm membrane: a character row is born on a realm and dies
    // on it. Realm scoping is what isolates a pay-to-win realm's economy, so no
    // code path may ever re-home a character (a transfer feature would need its
    // own reviewed design; this pin makes that a deliberate act).
    const serverDir = join(__dirname, '..', 'server');
    const offenders: string[] = [];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(serverDir);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const re = /UPDATE\s+characters\b([\s\S]*?)(WHERE|$)/gi;
      for (let m = re.exec(src); m !== null; m = re.exec(src)) {
        const setClause = m[1];
        if (/\brealm\s*=/.test(setClause)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
