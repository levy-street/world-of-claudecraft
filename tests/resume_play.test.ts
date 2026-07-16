import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPlayMarker,
  freshMarker,
  MAX_RESUME_ATTEMPTS,
  markResumeAttempt,
  parseMarker,
  RESUME_KEY,
  RESUME_MAX_AGE_MS,
  readPlayMarker,
  refreshPlayMarker,
  savePlayMarker,
  serializeMarker,
} from '../src/net/resume_play';

// minimal localStorage stub (the test env is plain node, no DOM)
function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

const MARKER = { characterId: 42, realm: 'Aldergate', savedAt: 1_000_000, attempts: 0 };

describe('storage contract (literals, not self-comparison)', () => {
  it('pins the storage key: renaming it orphans every player stored marker', () => {
    expect(RESUME_KEY).toBe('woc_active_play');
  });

  it('pins the serialized shape: changing it invalidates stored markers', () => {
    expect(serializeMarker(MARKER)).toBe(
      '{"characterId":42,"realm":"Aldergate","savedAt":1000000,"attempts":0}',
    );
  });
});

describe('parseMarker', () => {
  it('round-trips a valid marker', () => {
    expect(parseMarker(serializeMarker(MARKER))).toEqual(MARKER);
  });

  it('rejects null / empty / malformed json', () => {
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker('')).toBeNull();
    expect(parseMarker('{not json')).toBeNull();
  });

  it('rejects a non-positive or non-integer characterId', () => {
    expect(parseMarker(JSON.stringify({ ...MARKER, characterId: 0 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, characterId: -3 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, characterId: 4.5 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, characterId: '7' }))).toBeNull();
  });

  it('rejects a missing or empty or non-string realm', () => {
    expect(parseMarker(JSON.stringify({ characterId: 7, savedAt: 1 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, realm: '' }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, realm: 5 }))).toBeNull();
  });

  it('rejects a missing or non-finite savedAt', () => {
    expect(parseMarker(JSON.stringify({ characterId: 7, realm: 'A' }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, savedAt: 'x' }))).toBeNull();
    // JSON cannot carry Infinity, but a hand-built object shape must still reject it.
    expect(parseMarker('{"characterId":7,"realm":"A","savedAt":null}')).toBeNull();
  });

  it('defaults a missing attempts to 0 and rejects a malformed one', () => {
    expect(parseMarker('{"characterId":7,"realm":"A","savedAt":1}')).toEqual({
      characterId: 7,
      realm: 'A',
      savedAt: 1,
      attempts: 0,
    });
    expect(parseMarker(JSON.stringify({ ...MARKER, attempts: -1 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, attempts: 1.5 }))).toBeNull();
    expect(parseMarker(JSON.stringify({ ...MARKER, attempts: '2' }))).toBeNull();
  });
});

describe('freshMarker', () => {
  const now = 10_000_000;
  const at = (savedAt: number, attempts = 0) => ({ ...MARKER, savedAt, attempts });

  it('returns the marker inside the freshness window', () => {
    expect(freshMarker(at(now - 1000), now)).toEqual(at(now - 1000));
    // exactly at the boundary is still honored
    expect(freshMarker(at(now - RESUME_MAX_AGE_MS), now)).toEqual(at(now - RESUME_MAX_AGE_MS));
  });

  it('returns null for a stale marker (older than the window)', () => {
    expect(freshMarker(at(now - RESUME_MAX_AGE_MS - 1), now)).toBeNull();
  });

  it('returns null for a null marker', () => {
    expect(freshMarker(null, now)).toBeNull();
  });

  it('returns null on a backwards clock (marker from the future)', () => {
    expect(freshMarker(at(now + 5000), now)).toBeNull();
  });

  it('returns null once the resume attempt budget is spent', () => {
    expect(freshMarker(at(now - 1000, MAX_RESUME_ATTEMPTS - 1), now)).not.toBeNull();
    expect(freshMarker(at(now - 1000, MAX_RESUME_ATTEMPTS), now)).toBeNull();
    expect(freshMarker(at(now - 1000, MAX_RESUME_ATTEMPTS + 1), now)).toBeNull();
  });
});

describe('storage wrappers', () => {
  it('save then read a marker at the given time, attempts reset to 0', () => {
    savePlayMarker(123, 'Aldergate', 555);
    expect(readPlayMarker()).toEqual({
      characterId: 123,
      realm: 'Aldergate',
      savedAt: 555,
      attempts: 0,
    });
    expect(localStorage.getItem(RESUME_KEY)).not.toBeNull();
  });

  it('refresh re-stamps savedAt of a fresh marker, keeping character and realm', () => {
    savePlayMarker(123, 'Aldergate', 555);
    refreshPlayMarker(9_999);
    expect(readPlayMarker()).toEqual({
      characterId: 123,
      realm: 'Aldergate',
      savedAt: 9_999,
      attempts: 0,
    });
  });

  it('refresh CLEARS a stale marker instead of resurrecting it', () => {
    savePlayMarker(123, 'Aldergate', 0);
    refreshPlayMarker(RESUME_MAX_AGE_MS + 1);
    expect(readPlayMarker()).toBeNull();
    expect(localStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('refresh is a no-op when no marker is stored', () => {
    refreshPlayMarker(9_999);
    expect(readPlayMarker()).toBeNull();
  });

  it('markResumeAttempt increments the persisted budget until fresh rejects it', () => {
    savePlayMarker(123, 'Aldergate', 555);
    markResumeAttempt();
    expect(readPlayMarker()?.attempts).toBe(1);
    for (let i = 1; i < MAX_RESUME_ATTEMPTS; i++) markResumeAttempt();
    expect(readPlayMarker()?.attempts).toBe(MAX_RESUME_ATTEMPTS);
    expect(freshMarker(readPlayMarker(), 556)).toBeNull();
    // a completed entry resets the budget
    savePlayMarker(123, 'Aldergate', 557);
    expect(readPlayMarker()?.attempts).toBe(0);
  });

  it('markResumeAttempt is a no-op when no marker is stored', () => {
    markResumeAttempt();
    expect(readPlayMarker()).toBeNull();
  });

  it('clear removes the marker', () => {
    savePlayMarker(123, 'Aldergate', 555);
    clearPlayMarker();
    expect(readPlayMarker()).toBeNull();
    expect(localStorage.getItem(RESUME_KEY)).toBeNull();
  });

  it('a stale saved marker is rejected by the freshness gate end-to-end', () => {
    savePlayMarker(77, 'Aldergate', 0);
    // A read gives the marker back verbatim, but the fresh gate rejects it.
    expect(readPlayMarker()).toEqual({
      characterId: 77,
      realm: 'Aldergate',
      savedAt: 0,
      attempts: 0,
    });
    expect(freshMarker(readPlayMarker(), RESUME_MAX_AGE_MS + 1)).toBeNull();
  });

  it('fails soft when localStorage throws (private mode / SSR)', () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    // None of these may throw.
    expect(() => savePlayMarker(1, 'A', 1)).not.toThrow();
    expect(readPlayMarker()).toBeNull();
    expect(() => refreshPlayMarker(1)).not.toThrow();
    expect(() => markResumeAttempt()).not.toThrow();
    expect(() => clearPlayMarker()).not.toThrow();
  });
});

// The behavior the fix delivers lives in main.ts wiring; pin the load-bearing
// call sites so a refactor cannot silently drop one (same readFileSync idiom as
// tests/play_online_only.test.ts).
describe('main.ts resume wiring', () => {
  const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

  it('saves the marker (with realm) when world entry completes', () => {
    expect(mainTs).toContain('if (api.realm) savePlayMarker(c.id, api.realm, Date.now());');
  });

  it('clears the marker inside fatalOverlay, with the conflict opt-out', () => {
    expect(mainTs).toContain('if (!opts?.keepResumeMarker) clearPlayMarker();');
    expect(mainTs).toContain('keepResumeMarker: reason === RECONNECT_CONFLICT_ERROR,');
  });

  it('clears the marker beside every clearSession-style logout site', () => {
    // Exact count: in-game logout, account logout, session expiry, deactivate,
    // recovery-email hatch, boot auth failure, roster mismatch, fatalOverlay,
    // and the boot dead-marker clear. A new terminal site must bump this; a
    // silently deleted one fails it.
    const clears = mainTs.match(/clearPlayMarker\(\);/g) ?? [];
    expect(clears.length).toBe(9);
    expect(mainTs).toContain('api.clearSession();\n    clearPlayMarker();');
  });

  it('boot resume counts an attempt, restores the realm, and is guarded', () => {
    expect(mainTs).toContain('markResumeAttempt();');
    expect(mainTs).toContain('localStorage.setItem(LAST_REALM_KEY, resume.realm);');
    expect(mainTs).toContain('if (isDesktopLoginPage()) return;');
    // the Discord-onboarding arm enters play itself; resume must not double-enter
    expect(mainTs).toContain('if (discordOnboarding) return;');
    // a marker that no longer resumes (stale or spent) is cleared, not kept
    expect(mainTs).toContain('if (marker) clearPlayMarker();');
  });

  it('drops the pending intent on every non-entry landing', () => {
    // the realm list (no remembered realm) and a failed roster load both disarm
    expect(mainTs).toContain("pendingResume = null;\n  show('#realm-panel');");
    expect(mainTs).toContain(
      'pendingResume = null;\n    listEl.innerHTML = `<li class="char-list-message char-list-error">',
    );
  });

  it('the roster consume gate requires the marker realm to match the api realm', () => {
    expect(mainTs).toContain(
      'resume.realm === api.realm ? chars.find((c) => c.id === resume.characterId) : undefined',
    );
    // a missing character or realm mismatch clears the persisted marker
    expect(mainTs).toContain(
      'if (target) {\n        void enterWorld(target);\n        return;\n      }\n      clearPlayMarker();',
    );
  });

  it('re-stamps on hide and pagehide via the freshness-gated refresh', () => {
    expect(mainTs).toContain("if (document.visibilityState === 'hidden') refreshPlayMarker(");
    expect(mainTs).toContain("window.addEventListener('pagehide', () => refreshPlayMarker(");
  });
});
