import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkpointEntryProbe,
  ENTRY_ALIVE_WINDOW_MS,
  ENTRY_CRASH_WINDOW_MS,
  ENTRY_HEARTBEAT_MS,
  ENTRY_PRESET_MIN,
  ENTRY_PROBE_KEY,
  ENTRY_RECOVERY_LOG_KEY,
  heartbeatEntryProbe,
  parseEntryRecoveryLog,
  parseProbe,
  persistEntryRecoveryLog,
  planEntryCrashRecovery,
  serializeEntryRecoveryLog,
  serializeProbe,
  stampEntryCheckpoint,
  stampEntryHeartbeat,
  stampEntryProbe,
  stepDownPreset,
} from '../src/game/entry_crash_guard';

const NOW = 1_700_000_000_000;

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
});

describe('entry crash guard: probe serialization', () => {
  it('round-trips a probe', () => {
    const raw = serializeProbe({ preset: 3, at: NOW });
    expect(parseProbe(raw)).toEqual({ preset: 3, at: NOW });
  });

  it('round-trips a diagnostic checkpoint without breaking legacy probes', () => {
    const raw = serializeProbe({
      preset: 2,
      at: NOW,
      checkpoint: 'first-frame',
      checkpointAt: NOW + 800,
      diagnostics: {
        tier: 'medium',
        viewport: '852x393',
        devicePixelRatio: 3,
        textures: 91,
        programs: 17,
      },
    });
    expect(parseProbe(raw)).toEqual({
      preset: 2,
      at: NOW,
      checkpoint: 'first-frame',
      checkpointAt: NOW + 800,
      diagnostics: {
        tier: 'medium',
        viewport: '852x393',
        devicePixelRatio: 3,
        textures: 91,
        programs: 17,
      },
    });
    expect(parseProbe(serializeProbe({ preset: 2, at: NOW }))).toEqual({ preset: 2, at: NOW });
  });

  it('drops invalid optional diagnostic fields but keeps a valid base probe', () => {
    const raw = JSON.stringify({
      preset: 2,
      at: NOW,
      checkpoint: 'invented-phase',
      checkpointAt: 'later',
      diagnostics: { tier: ['medium'], textures: Number.NaN },
    });
    expect(parseProbe(raw)).toEqual({ preset: 2, at: NOW });
  });

  it('reads malformed and foreign values as no probe', () => {
    expect(parseProbe(null)).toBeNull();
    expect(parseProbe('')).toBeNull();
    expect(parseProbe('not json')).toBeNull();
    expect(parseProbe('42')).toBeNull();
    expect(parseProbe('{}')).toBeNull();
    expect(parseProbe('{"preset":"high","at":1}')).toBeNull();
    expect(parseProbe('{"preset":2}')).toBeNull();
    expect(parseProbe(`{"preset":null,"at":${NOW}}`)).toBeNull();
    expect(parseProbe(`{"preset":${Number.NaN},"at":${NOW}}`)).toBeNull();
  });

  it('pins the storage key other modules and devices rely on', () => {
    expect(ENTRY_PROBE_KEY).toBe('woc_entry_probe');
    expect(ENTRY_RECOVERY_LOG_KEY).toBe('woc_entry_last_recovery');
  });
});

describe('entry crash guard: retained recovery log', () => {
  it('round-trips the last recovery so it remains inspectable after the probe is consumed', () => {
    const report = {
      recoveredAt: NOW,
      from: 2,
      to: 1,
      ageMs: 15_000,
      checkpoint: 'rendering' as const,
      checkpointAgeMs: 1_500,
      diagnostics: { frame: 120, textures: 143 },
    };
    expect(parseEntryRecoveryLog(serializeEntryRecoveryLog(report))).toEqual(report);
  });

  it('rejects malformed recovery logs', () => {
    expect(parseEntryRecoveryLog(null)).toBeNull();
    expect(parseEntryRecoveryLog('garbage')).toBeNull();
    expect(parseEntryRecoveryLog('{"recoveredAt":1,"from":"medium"}')).toBeNull();
  });
});

describe('entry crash guard: diagnostic checkpoints', () => {
  it('advances a valid probe while preserving its original start time and preset', () => {
    const raw = serializeProbe({ preset: 2, at: NOW });
    expect(
      checkpointEntryProbe(raw, 'renderer-built', NOW + 450, {
        tier: 'medium',
        constrainedMemory: false,
        shadowMap: 1024,
      }),
    ).toBe(
      serializeProbe({
        preset: 2,
        at: NOW,
        checkpoint: 'renderer-built',
        checkpointAt: NOW + 450,
        diagnostics: { tier: 'medium', constrainedMemory: false, shadowMap: 1024 },
      }),
    );
  });

  it('does not manufacture a probe when entry is not armed', () => {
    expect(checkpointEntryProbe(null, 'first-frame', NOW, { frame: 1 })).toBeNull();
    expect(checkpointEntryProbe('garbage', 'first-frame', NOW, { frame: 1 })).toBeNull();
  });

  it('persists checkpoints and the consumed recovery report under separate keys', () => {
    stampEntryProbe(2, NOW);
    stampEntryCheckpoint('first-frame', NOW + 800, { frame: 1, textures: 91 });
    const probe = parseProbe(localStorage.getItem(ENTRY_PROBE_KEY));
    expect(probe).toMatchObject({
      preset: 2,
      checkpoint: 'first-frame',
      diagnostics: { frame: 1, textures: 91 },
    });

    const recovery = planEntryCrashRecovery(localStorage.getItem(ENTRY_PROBE_KEY), NOW + 1_000);
    expect(recovery).not.toBeNull();
    if (!recovery) throw new Error('expected a recovery report');
    persistEntryRecoveryLog(recovery, NOW + 1_000);
    expect(parseEntryRecoveryLog(localStorage.getItem(ENTRY_RECOVERY_LOG_KEY))).toMatchObject({
      recoveredAt: NOW + 1_000,
      checkpoint: 'first-frame',
      diagnostics: { frame: 1, textures: 91 },
    });
  });

  it('bounds diagnostic keys and strings before persistence', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`field${index}`, 'x'.repeat(200)]),
    );
    const raw = checkpointEntryProbe(
      serializeProbe({ preset: 2, at: NOW }),
      'rendering',
      NOW + 1,
      fields,
    );
    const diagnostics = parseProbe(raw)?.diagnostics;
    expect(Object.keys(diagnostics ?? {})).toHaveLength(48);
    expect(diagnostics?.field0).toBe('x'.repeat(160));
    expect(diagnostics?.field47).toBe('x'.repeat(160));
    expect(diagnostics?.field48).toBeUndefined();
  });

  it('keeps all storage writes fail-soft', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(() => stampEntryProbe(2, NOW)).not.toThrow();
    expect(() => stampEntryCheckpoint('first-frame', NOW)).not.toThrow();
    expect(() => persistEntryRecoveryLog({ from: 2, to: 1, ageMs: 1_000 }, NOW)).not.toThrow();
  });
});

describe('entry crash guard: liveness heartbeat', () => {
  it('pins the cadence inside the alive window with room for a slow phone boot', () => {
    expect(ENTRY_ALIVE_WINDOW_MS).toBeGreaterThanOrEqual(ENTRY_HEARTBEAT_MS * 3);
    expect(ENTRY_ALIVE_WINDOW_MS).toBeLessThan(ENTRY_CRASH_WINDOW_MS);
  });

  it('round-trips aliveAt and drops an invalid one without losing the probe', () => {
    expect(parseProbe(serializeProbe({ preset: 2, at: NOW, aliveAt: NOW + 5 }))).toEqual({
      preset: 2,
      at: NOW,
      aliveAt: NOW + 5,
    });
    expect(parseProbe(JSON.stringify({ preset: 2, at: NOW, aliveAt: 'soon' }))).toEqual({
      preset: 2,
      at: NOW,
    });
  });

  it('refreshes only aliveAt and keeps every breadcrumb', () => {
    const raw = checkpointEntryProbe(
      serializeProbe({ preset: 2, at: NOW }),
      'first-frame',
      NOW + 10,
      {
        frame: 1,
      },
    );
    expect(parseProbe(heartbeatEntryProbe(raw, NOW + 20))).toEqual({
      preset: 2,
      at: NOW,
      checkpoint: 'first-frame',
      checkpointAt: NOW + 10,
      diagnostics: { frame: 1 },
      aliveAt: NOW + 20,
    });
    // A later checkpoint keeps the heartbeat it does not own.
    expect(
      parseProbe(checkpointEntryProbe(heartbeatEntryProbe(raw, NOW + 20), 'rendering', NOW + 30)),
    ).toMatchObject({
      checkpoint: 'rendering',
      aliveAt: NOW + 20,
    });
    expect(heartbeatEntryProbe(null, NOW)).toBeNull();
    expect(heartbeatEntryProbe(raw, Number.NaN)).toBeNull();
  });

  it('stamps the heartbeat into storage only while a probe is armed', () => {
    const store = new Map<string, string>();
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });
    try {
      stampEntryHeartbeat(NOW);
      expect(store.has(ENTRY_PROBE_KEY)).toBe(false);
      store.set(ENTRY_PROBE_KEY, serializeProbe({ preset: 2, at: NOW }));
      stampEntryHeartbeat(NOW + 5_000);
      expect(parseProbe(store.get(ENTRY_PROBE_KEY) ?? null)?.aliveAt).toBe(NOW + 5_000);
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('entry crash guard: stepDownPreset', () => {
  it('steps each tier down one', () => {
    expect(stepDownPreset(5)).toBe(4);
    expect(stepDownPreset(4)).toBe(3);
    expect(stepDownPreset(3)).toBe(2);
    expect(stepDownPreset(2)).toBe(1);
  });

  it('never goes below the low floor', () => {
    expect(stepDownPreset(1)).toBe(ENTRY_PRESET_MIN);
    expect(stepDownPreset(0)).toBe(ENTRY_PRESET_MIN);
    expect(stepDownPreset(-7)).toBe(ENTRY_PRESET_MIN);
  });

  it('clamps values above the settings range before stepping', () => {
    expect(stepDownPreset(99)).toBe(4);
  });
});

describe('entry crash guard: planEntryCrashRecovery', () => {
  it('recovers from a fresh crash probe with a one-tier step down', () => {
    const raw = serializeProbe({ preset: 2, at: NOW - 15_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({ from: 2, to: 1, ageMs: 15_000 });
  });

  it('returns the last durable checkpoint and render evidence after a reload', () => {
    const raw = serializeProbe({
      preset: 2,
      at: NOW - 15_000,
      checkpoint: 'rendering',
      checkpointAt: NOW - 1_500,
      diagnostics: {
        frame: 120,
        frameMs: 18.4,
        textures: 143,
        contextLost: 0,
        governorMode: 'recovering',
      },
    });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 2,
      to: 1,
      ageMs: 15_000,
      checkpoint: 'rendering',
      checkpointAgeMs: 1_500,
      diagnostics: {
        frame: 120,
        frameMs: 18.4,
        textures: 143,
        contextLost: 0,
        governorMode: 'recovering',
      },
    });
  });

  it('keeps the floor preset at the floor (still recovers, so the loop still breaks)', () => {
    const raw = serializeProbe({ preset: 1, at: NOW - 1_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({ from: 1, to: 1, ageMs: 1_000 });
  });

  it('ignores a stale probe: a crash days ago says nothing about this boot', () => {
    const raw = serializeProbe({ preset: 3, at: NOW - ENTRY_CRASH_WINDOW_MS - 1 });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('honors a probe exactly at the window edge', () => {
    const raw = serializeProbe({ preset: 3, at: NOW - ENTRY_CRASH_WINDOW_MS });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 3,
      to: 2,
      ageMs: ENTRY_CRASH_WINDOW_MS,
    });
  });

  it('recovers an older stable session when a recent More checkpoint proves a fresh crash', () => {
    const raw = serializeProbe({
      preset: 2,
      at: NOW - ENTRY_CRASH_WINDOW_MS * 2,
      checkpoint: 'mobile-more-open',
      checkpointAt: NOW - 750,
      diagnostics: { calls: 411, triangles: 2_872_588 },
    });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 2,
      to: 1,
      ageMs: ENTRY_CRASH_WINDOW_MS * 2,
      checkpoint: 'mobile-more-open',
      checkpointAgeMs: 750,
      diagnostics: { calls: 411, triangles: 2_872_588 },
    });
  });

  it('recovers when the heartbeat ran until the last seconds before the reload (foreground kill)', () => {
    const raw = serializeProbe({
      preset: 2,
      at: NOW - ENTRY_CRASH_WINDOW_MS * 3,
      checkpoint: 'runtime-stable',
      checkpointAt: NOW - ENTRY_CRASH_WINDOW_MS * 3 + 20_000,
      aliveAt: NOW - 8_000,
    });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 2,
      to: 1,
      ageMs: ENTRY_CRASH_WINDOW_MS * 3,
      checkpoint: 'runtime-stable',
      checkpointAgeMs: ENTRY_CRASH_WINDOW_MS * 3 - 20_000,
      aliveAgeMs: 8_000,
    });
  });

  it('ignores a probe whose heartbeat stopped before the reload: the page was backgrounded, not killed', () => {
    // The reported iOS case: the player backgrounded the app (heartbeat stops), the
    // hidden-lifecycle probe removal never reached disk, iOS reclaimed the WebView
    // minutes later and the foreground reload found a probe with a recent dialog
    // checkpoint inside the 10-minute window. Before the heartbeat this read as an
    // entry crash and cost the player the resume marker on every such cycle.
    const raw = serializeProbe({
      preset: 1,
      at: NOW - 30 * 60_000,
      checkpoint: 'mobile-more-closed',
      checkpointAt: NOW - 4 * 60_000,
      aliveAt: NOW - ENTRY_ALIVE_WINDOW_MS - 1,
    });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('honors a heartbeat exactly at the alive window edge', () => {
    const raw = serializeProbe({
      preset: 3,
      at: NOW - 60_000,
      aliveAt: NOW - ENTRY_ALIVE_WINDOW_MS,
    });
    expect(planEntryCrashRecovery(raw, NOW)).toEqual({
      from: 3,
      to: 2,
      ageMs: 60_000,
      aliveAgeMs: ENTRY_ALIVE_WINDOW_MS,
    });
  });

  it('keeps the wide entry window for a probe that never reached the frame loop', () => {
    // No heartbeat means the synchronous scene build (which cannot heartbeat) was
    // still running: the original crash-at-entry rule stands unchanged.
    const raw = serializeProbe({
      preset: 3,
      at: NOW - ENTRY_CRASH_WINDOW_MS + 1_000,
      checkpoint: 'renderer-built',
      checkpointAt: NOW - ENTRY_CRASH_WINDOW_MS + 1_000,
    });
    expect(planEntryCrashRecovery(raw, NOW)).not.toBeNull();
  });

  it('ignores a heartbeat from the future (clock went backwards)', () => {
    const raw = serializeProbe({ preset: 3, at: NOW - 5_000, aliveAt: NOW + 1 });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('ignores a probe from the future (clock went backwards)', () => {
    const raw = serializeProbe({ preset: 3, at: NOW + 60_000 });
    expect(planEntryCrashRecovery(raw, NOW)).toBeNull();
  });

  it('ignores missing or malformed probes', () => {
    expect(planEntryCrashRecovery(null, NOW)).toBeNull();
    expect(planEntryCrashRecovery('garbage', NOW)).toBeNull();
  });
});

describe('entry diagnostics wiring', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('retains recovery evidence before consuming the one-shot probe', () => {
    const planAt = mainSource.indexOf(
      'planEntryCrashRecovery(readEntryProbeRaw(), entryRecoveryAt)',
    );
    const persistAt = mainSource.indexOf('persistEntryRecoveryLog(entryRecovery, entryRecoveryAt)');
    const clearAt = mainSource.indexOf('clearEntryProbe();', persistAt);
    expect(planAt).toBeGreaterThan(-1);
    expect(persistAt).toBeGreaterThan(planAt);
    expect(clearAt).toBeGreaterThan(persistAt);
  });

  it('wires the controller across build, prewarm, frame, and paint boundaries', () => {
    expect(mainSource).toContain("entryDiagnostics.start(settings.get('graphicsPreset'));");
    expect(mainSource).toContain("entryDiagnostics.checkpoint('renderer-built');");
    expect(mainSource).toContain("entryDiagnostics.checkpoint('hud-built');");
    expect(mainSource).toContain("entryDiagnostics.checkpoint('prewarm-start'");
    expect(mainSource).toContain("entryDiagnostics.checkpoint('prewarm-complete'");
    expect(mainSource).toContain('entryDiagnostics.renderedFrame(now);');
    expect(mainSource).toContain("entryDiagnostics.checkpoint('first-paint');");
  });

  it('retains the constrained workload and governor evidence needed for device triage', () => {
    expect(mainSource).toContain('dynamicShadows: GFX.dynamicShadows');
    expect(mainSource).toContain('grassLevel: stats.qualityBuckets.levels.grass');
    expect(mainSource).toContain('foliageLevel: stats.qualityBuckets.levels.foliage');
    expect(mainSource).toContain('lastSubmitStallMs: stats.renderBudget.lastSubmitStallMs');
    expect(mainSource).toContain('visibleViews: frameStats.visibleViews');
    expect(mainSource).toContain('grassTufts: frameStats.foliage.grassVisibleTufts');
  });
});
