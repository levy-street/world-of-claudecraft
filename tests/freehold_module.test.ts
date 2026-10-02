// Dark-host pins for src/sim/freehold/ and the IWorldHousing members on Sim.
// The eight not-yet-lit housing commands remain inert while the host flag
// controls the furnisher; the two lit ones (enter and leave) refuse text-free
// on a dark host. These assertions cover null descriptors, one shared clock
// base, eight stubs that neither mutate, emit nor draw on each host
// configuration, the dark-host refusal of the lit pair, a record lifecycle
// that is a pure value round-trip on a lit host and two inserters that insert
// nothing on a dark one, and a source scan that keeps the sim core and its
// three sibling housing modules free of store vocabulary and the sim core
// free of wall clocks.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  asFreeholdPlotId,
  defaultFreeholdState,
  ensureFreeholdRecord,
  evictFreehold,
  type FreeholdState,
  loadFreehold,
  PENDING_FREEHOLD_PLOT_ID,
  serializeFreehold,
} from '../src/sim/freehold';
import type { FreeholdPlotId, FreeholdView } from '../src/sim/freehold/types';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const makeSim = () => new Sim({ seed: 1, playerClass: 'warrior' });
// A source-free event the drain control queues by hand; emit pushes it as is.
const CONTROL_EVENT: SimEvent = { type: 'respawn' };

// Everything a stub could plausibly touch, as a value snapshot: the serialized
// character (bags, gold, equipment, quests, professions), the live position
// and heading, the housing map, and the sim clock.
function snapshot(sim: Sim, pid: number) {
  const e = sim.entities.get(pid);
  return {
    character: JSON.parse(JSON.stringify(sim.serializeCharacter(pid))),
    pos: e ? { ...e.pos } : null,
    facing: e?.facing ?? null,
    hp: e?.hp ?? null,
    freeholds: [...sim.freeholds.entries()],
    entities: sim.entities.size,
    time: sim.time,
    tickCount: sim.tickCount,
  };
}

// The two LIT commands (the owner-keyed claim in src/sim/freehold/instance.ts)
// and the eight command stubs, each invoked the way the server does (explicit
// pid) and the way the offline IWorld caller does (no pid, the primaryId
// default).
const LIT: ReadonlyArray<[string, (sim: Sim, pid?: number) => void]> = [
  ['freeholdEnter', (sim, pid) => sim.freeholdEnter(pid)],
  ['freeholdLeave', (sim, pid) => sim.freeholdLeave(pid)],
];
const STUBS: ReadonlyArray<[string, (sim: Sim, pid?: number) => void]> = [
  ['placeFurnishing', (sim, pid) => sim.placeFurnishing(0, 1, 2, 3, 0.5, pid)],
  ['moveFurnishing', (sim, pid) => sim.moveFurnishing(7, 1, 2, 3, 0.5, pid)],
  ['removeFurnishing', (sim, pid) => sim.removeFurnishing(7, pid)],
  ['undoPlacement', (sim, pid) => sim.undoPlacement(pid)],
  ['redoPlacement', (sim, pid) => sim.redoPlacement(pid)],
  ['payLedger', (sim, pid) => sim.payLedger(pid)],
  ['setVisitPolicy', (sim, pid) => sim.setVisitPolicy('open', pid)],
  ['setFreeholdBuildPresence', (sim, pid) => sim.setFreeholdBuildPresence(true, pid)],
];

describe('IWorldHousing on the offline Sim (dark)', () => {
  it('reads null descriptors, an empty record map, and the farm clock base', () => {
    const sim = makeSim();
    expect(sim.myFreehold).toBeNull();
    expect(sim.freeholdLayout).toBeNull();
    expect(sim.freeholds.size).toBe(0);
    expect(sim.housingNowMs()).toBe(sim.farmNowMs());
    for (let i = 0; i < 25; i++) sim.tick();
    expect(sim.housingNowMs()).toBe(sim.farmNowMs());
    expect(sim.housingNowMs()).toBe(Math.floor(sim.time * 1000));
  });

  it('housingNowMs is the host lockout clock, byte for byte with farmNowMs', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', lockoutNowMs: () => 1_725_000_000_000 });
    expect(sim.housingNowMs()).toBe(1_725_000_000_000);
    expect(sim.farmNowMs()).toBe(1_725_000_000_000);
  });

  it('exposes every member as a real prototype method or getter (the IWORLD_MEMBERS probe)', () => {
    for (const name of ['myFreehold', 'freeholdLayout']) {
      expect(typeof Object.getOwnPropertyDescriptor(Sim.prototype, name)?.get).toBe('function');
    }
    for (const name of ['housingNowMs', ...LIT.map(([n]) => n), ...STUBS.map(([n]) => n)]) {
      expect(typeof Object.getOwnPropertyDescriptor(Sim.prototype, name)?.value).toBe('function');
    }
  });

  it('every delegate REACHES the module and resolves the caller (deleting one is not invisible)', () => {
    // "Changes nothing" is also true of a delegate deleted outright, so the
    // no-op pin below cannot see the wiring. Every module body opens with
    // `ctx.resolve(pid)`, so spying that one seam proves each Sim method
    // actually reaches src/sim/freehold/ AND pins the `pid ?? this.primaryId`
    // default at the same time. (ctx.resolve is an own data property bound in
    // the ctor, so the spy takes.)
    const sim = makeSim();
    const pid = sim.primaryId;
    for (const [name, call] of [...LIT, ...STUBS]) {
      const resolve = vi.spyOn(sim.ctx, 'resolve');
      call(sim, pid);
      expect(resolve, `${name} with an explicit pid`).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0][0], `${name} passes the pid through`).toBe(pid);

      resolve.mockClear();
      call(sim);
      expect(resolve, `${name} with the default pid`).toHaveBeenCalledTimes(1);
      expect(resolve.mock.calls[0][0], `${name} defaults to primaryId`).toBe(sim.primaryId);
      resolve.mockRestore();
    }
    // The two DESCRIPTORS need a different proof. They read null and resolve
    // nobody today, so no runtime probe can tell a delegate from a `return
    // null` body on the coordinator: a resolve spy stays silent either way, and
    // asserting that silence would pin nothing. What actually matters is that
    // the body lives in the module, so 05/08a lights it there instead of
    // growing the zero-slack coordinator. Pin that on comment-stripped source.
    expect(sim.myFreehold).toBeNull();
    expect(sim.freeholdLayout).toBeNull();
    // Comments stripped first, or a `return null;` in prose would fail the
    // negative arm and a delegate named only in a comment would pass the
    // positive one (the source-pin trap this repo has paid for before).
    const simSrc = readFileSync(join(__dirname, '..', 'src', 'sim', 'sim.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const [member, fn] of [
      ['myFreehold', 'myFreeholdView'],
      ['freeholdLayout', 'freeholdLayoutView'],
    ] as const) {
      const at = simSrc.indexOf(`get ${member}()`);
      expect(at, `Sim must declare the ${member} getter`).toBeGreaterThanOrEqual(0);
      const body = simSrc.slice(at, simSrc.indexOf('\n  }', at));
      expect(body, `${member} must delegate, not answer inline`).toContain(`freeholdMod.${fn}(`);
      expect(body, `${member} must not carry an inline literal answer`).not.toMatch(
        /return\s+null\s*;/,
      );
    }
  });

  it('every stub changes nothing, emits nothing and draws no rng, with an explicit pid and with the default', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.drainEvents(); // the ctor's own events are not the stubs'
    try {
      for (const [name, call] of STUBS) {
        const before = snapshot(sim, pid);
        call(sim, pid);
        call(sim);
        call(sim, 999_999); // an unknown pid resolves to nobody and is ignored
        expect(snapshot(sim, pid), name).toEqual(before);
        expect(draws, name).toBe(0);
        // The one player-visible channel a value snapshot cannot see.
        expect(sim.drainEvents(), name).toEqual([]);
      }
      // Positive controls: the observer is wired to THIS sim's stream, so one
      // direct draw is counted, and the drain sees an event this sim queues.
      // Without these the zeros and the empty drains above prove nothing.
      sim.rng.next();
      expect(draws).toBe(1);
      sim.emit(CONTROL_EVENT);
      expect(sim.drainEvents()).toEqual([CONTROL_EVENT]);
    } finally {
      sim.rng.setObserver(null);
    }
  });

  it('the lit pair on a DARK host: enter refuses text-free, leave is a silent no-op, nothing changes', () => {
    const sim = makeSim();
    const pid = sim.primaryId;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.drainEvents();
    try {
      const before = snapshot(sim, pid);
      // No record is seeded on a dark host, so every entry answers no_freehold
      // (the flag ruling in src/sim/freehold/commands.ts): one id-carrying,
      // pid-scoped event per call, never a log or error line.
      sim.freeholdEnter(pid);
      sim.freeholdEnter();
      sim.freeholdEnter(999_999); // an unknown pid resolves to nobody and is ignored
      expect(sim.drainEvents()).toEqual([
        { type: 'freeholdDenied', pid, reason: 'no_freehold' },
        { type: 'freeholdDenied', pid, reason: 'no_freehold' },
      ]);
      expect(snapshot(sim, pid)).toEqual(before);
      // Leaving while not inside any freehold is a silent no-op.
      sim.freeholdLeave(pid);
      sim.freeholdLeave();
      sim.freeholdLeave(999_999);
      expect(sim.drainEvents()).toEqual([]);
      expect(snapshot(sim, pid)).toEqual(before);
      expect(draws).toBe(0);
      sim.rng.next();
      expect(draws).toBe(1); // the observer is wired to THIS sim's stream
    } finally {
      sim.rng.setObserver(null);
    }
  });

  it('the Sim-owned record map is the ctx live view and stays empty across ticks', () => {
    const sim = makeSim();
    expect(sim.ctx.freeholds).toBe(sim.freeholds);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.freeholds.size).toBe(0);
    expect(sim.ctx.freeholdsEnabled).toBe(false);
  });

  // The flag now adds the furnisher, so cross-flag entity ids may differ.
  // On EACH configuration, commands must preserve the full seeded world.
  it.each([false, true])('housing stubs preserve the seeded host with flag %s', (enabled) => {
    const control = new Sim({ seed: 1, playerClass: 'warrior', freeholdsEnabled: enabled });
    const subject = new Sim({ seed: 1, playerClass: 'warrior', freeholdsEnabled: enabled });
    expect(control.ctx.freeholdsEnabled).toBe(enabled);
    expect(subject.ctx.freeholdsEnabled).toBe(enabled);
    const run = (sim: Sim, callStubs: boolean) => {
      for (let i = 0; i < 20; i++) sim.tick();
      if (callStubs) for (const [, call] of STUBS) call(sim);
      for (let i = 0; i < 20; i++) sim.tick();
    };
    run(control, false);
    run(subject, true);
    const positions = (sim: Sim) =>
      [...sim.entities.values()]
        .sort((a, b) => a.id - b.id)
        .map((e) => ({ id: e.id, pos: { ...e.pos }, facing: e.facing, hp: e.hp }));
    expect(subject.tickCount).toBe(40);
    expect(subject.tickCount).toBe(control.tickCount);
    expect(snapshot(subject, subject.primaryId)).toEqual(snapshot(control, control.primaryId));
    const subjectPositions = positions(subject);
    expect(subjectPositions.length).toBeGreaterThan(1); // the player and the world's mobs
    expect(subjectPositions).toEqual(positions(control));
    expect(subject.rng.next()).toBe(control.rng.next()); // the same stream position too
  });
});

describe('freehold/state.ts record lifecycle (the guild-bank idiom)', () => {
  // A LIT fake host: the two record inserters honor ctx.freeholdsEnabled (the
  // flag ruling), so the round-trip cases below run lit and the dark arm at
  // the end of this block runs on its own dark host.
  const fakeCtx = (freeholdsEnabled = true) => {
    const freeholds = new Map<string, FreeholdState>();
    return { ctx: { freeholds, freeholdsEnabled } as unknown as SimContext, freeholds };
  };

  it('defaultFreeholdState is the free tier-0 Inn Room, exactly', () => {
    expect(defaultFreeholdState('acct:1', asFreeholdPlotId('plot-1'))).toEqual({
      ownerKey: 'acct:1',
      plotId: asFreeholdPlotId('plot-1'),
      tier: 'inn_room',
      layout: [],
      trophies: [],
      condition: 100,
      conditionStampDay: 0,
      ledgerPaidThroughDay: 0,
      ledgerPrepaidWeeks: 0,
      visitPolicy: 'closed',
      isDecorating: false,
      rev: 0,
    });
  });

  it('load then serialize round-trips an equal VALUE copy that aliases nothing', () => {
    const { ctx, freeholds } = fakeCtx();
    const input = defaultFreeholdState('acct:1', asFreeholdPlotId('plot-1'));
    input.layout.push({ placementId: 3, itemId: 'oak_chair', x: 1, y: 0, z: 2, yaw: 0.25 });
    input.trophies.push({ plinth: 1, trophyId: 'boar_head' });
    input.rev = 4;
    loadFreehold(ctx, 'acct:1', input);
    const live = freeholds.get('acct:1');
    expect(live).toEqual(input);
    expect(live).not.toBe(input);
    expect(live?.layout).not.toBe(input.layout);
    expect(live?.layout[0]).not.toBe(input.layout[0]);
    input.layout[0].x = 99; // the caller's object is not the live record
    expect(live?.layout[0].x).toBe(1);

    const out = serializeFreehold(ctx, 'acct:1');
    expect(out).toEqual(live);
    expect(out).not.toBe(live);
    expect(out?.layout[0]).not.toBe(live?.layout[0]);
    if (out) out.layout[0].yaw = 3; // the snapshot is not the live record either
    expect(live?.layout[0].yaw).toBe(0.25);
  });

  it('serialize of an unloaded owner is null (the caller skips the write)', () => {
    const { ctx } = fakeCtx();
    expect(serializeFreehold(ctx, 'acct:none')).toBeNull();
  });

  it('keeps the public descriptor free of the owner stamp, by shape and by type', () => {
    // The invariant the whole housing surface rests on: the public identity and
    // the internal owner stamp are DIFFERENT values, and only the first ever
    // reaches a client. Two arms, because prose alone let `plotId: ownerKey`
    // type-check before the brand landed:
    //  (1) SHAPE: a FreeholdView carries exactly three keys, so a producer that
    //      spreads a whole FreeholdState into the descriptor reds here.
    const state = defaultFreeholdState('acct:secret-owner-key', asFreeholdPlotId('plot-1'));
    const view: FreeholdView = {
      plotId: state.plotId,
      tier: state.tier,
      visitPolicy: state.visitPolicy,
    };
    expect(Object.keys(view).sort()).toEqual(['plotId', 'tier', 'visitPolicy']);
    expect(Object.values(view)).not.toContain(state.ownerKey);
    expect(JSON.stringify(view)).not.toContain('secret-owner-key');
    //  (2) TYPE: the owner key is a bare string and the plot id is branded, so
    //      assigning one to the other is a compile error. @ts-expect-error is
    //      the assertion: if the brand were removed this line would compile and
    //      tsc would fail the build for an UNUSED expect-error, which is exactly
    //      the regression signal we want.
    // @ts-expect-error a raw owner key must never satisfy the opaque plot identity
    const forged: FreeholdPlotId = state.ownerKey;
    expect(typeof forged).toBe('string');
  });

  it('cross-pins the plot-id charset the wire will accept, for whoever generates one', () => {
    // The coupling that is invisible from either side alone: the client echoes
    // myFreehold.plotId back on every build-presence frame, and the server
    // admits 1..64 chars of [A-Za-z0-9_:-] there. So the id GENERATOR at 05/07
    // is constrained by a rule written in server/freehold_wire.ts, and a plot
    // id containing a dot or base64 padding would make that frame refuse
    // forever with no diagnostic. Pin the charset here, against a fresh literal
    // and a source read, so widening one side without the other reds.
    const wireSrc = readFileSync(join(__dirname, '..', 'server', 'freehold_wire.ts'), 'utf8');
    expect(wireSrc).toContain('const OPAQUE_ID_MAX_LEN = 64;');
    expect(wireSrc).toContain('const OPAQUE_ID_RE = /^[A-Za-z0-9_:-]+$/;');
    // The shapes a generator might reasonably reach for, judged against that
    // rule, so the failure mode is concrete rather than a regex staring match.
    const admits = (id: string) => id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_:-]+$/.test(id);
    expect(admits('plot-7')).toBe(true);
    expect(admits('acct:12:plot:3')).toBe(true);
    expect(admits('a'.repeat(64))).toBe(true);
    expect(admits('a'.repeat(65)), 'over the wire bound').toBe(false);
    expect(admits(''), 'empty').toBe(false);
    expect(admits('plot.7'), 'a dot is NOT admitted').toBe(false);
    expect(admits('plot/7'), 'a slash is NOT admitted').toBe(false);
    expect(admits('cGxvdA=='), 'base64 padding is NOT admitted').toBe(false);
    expect(admits('plot 7'), 'a space is NOT admitted').toBe(false);
  });

  it('strips ephemeral build presence from the snapshot and nothing else (C03)', () => {
    // Presence is a live per-session fact and must never reach SQL or JSON, so
    // the persistence boundary neutralizes it rather than trusting 07 to
    // remember. Every OTHER field must survive: the negative control below
    // drives a record whose fields are all off their defaults, so a strip that
    // widened to a second field would fail here rather than pass quietly.
    const { ctx, freeholds } = fakeCtx();
    const input: FreeholdState = {
      ownerKey: 'acct:7',
      plotId: asFreeholdPlotId('plot-7'),
      tier: 'manor',
      layout: [{ placementId: 2, itemId: 'oak_bench', x: 4, y: 1, z: 5, yaw: 1.5 }],
      trophies: [{ plinth: 3, trophyId: 'wolf_skull' }],
      condition: 62,
      conditionStampDay: 19,
      ledgerPaidThroughDay: 24,
      ledgerPrepaidWeeks: 2,
      visitPolicy: 'open',
      isDecorating: true,
      rev: 11,
    };
    loadFreehold(ctx, 'acct:7', input);
    // The LIVE record keeps presence: only the snapshot drops it.
    expect(freeholds.get('acct:7')?.isDecorating).toBe(true);

    const out = serializeFreehold(ctx, 'acct:7');
    expect(out?.isDecorating).toBe(false);
    expect(out).toEqual({ ...input, isDecorating: false });
    // And the strip does not alias: the live row is untouched by the snapshot.
    expect(freeholds.get('acct:7')?.isDecorating).toBe(true);
  });

  it('is load-once: a live record is never overwritten until evicted', () => {
    const { ctx, freeholds } = fakeCtx();
    loadFreehold(ctx, 'acct:1', defaultFreeholdState('acct:1', asFreeholdPlotId('plot-1')));
    const second = {
      ...defaultFreeholdState('acct:1', asFreeholdPlotId('plot-2')),
      tier: 'cottage' as const,
      rev: 9,
    };
    loadFreehold(ctx, 'acct:1', second);
    expect(freeholds.get('acct:1')?.plotId).toBe('plot-1');
    expect(freeholds.get('acct:1')?.tier).toBe('inn_room');
    evictFreehold(ctx, 'acct:1');
    expect(freeholds.has('acct:1')).toBe(false);
    expect(serializeFreehold(ctx, 'acct:1')).toBeNull();
    loadFreehold(ctx, 'acct:1', second);
    expect(freeholds.get('acct:1')?.tier).toBe('cottage');
    expect(freeholds.get('acct:1')?.rev).toBe(9);
  });

  it('pins the live ownerKey to the map key and ignores an empty key', () => {
    const { ctx, freeholds } = fakeCtx();
    loadFreehold(ctx, 'acct:2', defaultFreeholdState('acct:mismatch', asFreeholdPlotId('plot-1')));
    expect(freeholds.get('acct:2')?.ownerKey).toBe('acct:2');
    loadFreehold(ctx, '', defaultFreeholdState('', asFreeholdPlotId('plot-9')));
    expect(freeholds.size).toBe(1);
    expect(freeholds.has('')).toBe(false);
    evictFreehold(ctx, 'acct:never'); // evicting nothing is a no-op, never a throw
    expect(freeholds.size).toBe(1);
  });

  it('inserts nothing on a DARK host: loadFreehold is a no-op and ensureFreeholdRecord answers null', () => {
    // The flag ruling made mechanical: the inserters, not their callers, honor
    // ctx.freeholdsEnabled, so a persistence loader that runs on a dark realm
    // cannot seed it. Each inserter gets its own arm.
    const dark = fakeCtx(false);
    expect(dark.ctx.freeholdsEnabled).toBe(false);
    loadFreehold(dark.ctx, 'acct:1', defaultFreeholdState('acct:1', asFreeholdPlotId('plot-1')));
    expect(dark.freeholds.size).toBe(0);
    expect(serializeFreehold(dark.ctx, 'acct:1')).toBeNull();
    expect(ensureFreeholdRecord(dark.ctx, 'acct:1')).toBeNull();
    expect(dark.freeholds.size).toBe(0);
    // Positive control on the same shapes, lit: both insert.
    const lit = fakeCtx(true);
    loadFreehold(lit.ctx, 'acct:1', defaultFreeholdState('acct:1', asFreeholdPlotId('plot-1')));
    expect(lit.freeholds.has('acct:1')).toBe(true);
    expect(ensureFreeholdRecord(lit.ctx, 'acct:2')?.ownerKey).toBe('acct:2');
    expect(lit.freeholds.size).toBe(2);
  });
});

/** Every reference to the Hearth clock Map in `text` that is not a read
 *  (`.get(`, `.has(`, `.size`), a declaration, a forwarding getter, or the
 *  file's own sanctioned verb. Anything else hands the Map somewhere a writer
 *  could reach it, so it is an escape whatever it is spelled as. */
function clockMapEscapes(text: string, mayWrite: boolean, mayEvict: boolean): string[] {
  const escapes: string[] = [];
  for (const match of text.matchAll(/freeholdKeyReadyAtMs/g)) {
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    const getter = text.slice(Math.max(0, match.index - 80), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
    if (/^\.(?:get|has)\(|^\.size\b/.test(after)) continue;
    if (/^\(\)|^:\s*Map<|^\s*=\s*new Map</.test(after)) continue;
    // A `return` hand-off is the forwarding getter ONLY: its own body, nothing else.
    if (
      /get\s+freeholdKeyReadyAtMs\s*\(\)\s*\{\s*return\s+[\w$]+\.$/.test(getter) &&
      /^;/.test(after)
    )
      continue;
    if (mayWrite && /^\.set\(/.test(after)) continue;
    if (mayEvict && /^\.delete\(/.test(after)) continue;
    escapes.push(`${before}${match[0]}${after}`);
  }
  return escapes;
}

describe('the hearth clock map has two setters and one evictor, all in src/sim/freehold/', () => {
  it('is written nowhere outside src/sim/freehold/', () => {
    // The forward-only rule ("a durable clock behind the live one is a stale
    // read, and moving the cooldown backwards hands out a free travel") is one
    // rule, and a host that reaches into the Map itself would be a second place
    // it has to be implemented and kept correct. The server installs its
    // durable clock through mergeFreeholdKeyReadyAt instead.
    // src/sim IS scanned, with each sanctioned writer exempted for its OWN verb
    // only. Leaving the sim out was the gap: a third writer added in sim.ts or
    // another freehold leaf would have passed both arms of this describe.
    // THE SETTERS live in hearth_key.ts (useHearthKey, mergeFreeholdKeyReadyAt);
    // THE ONE EVICTOR is releaseFreeholdOnLeave in state.ts (07a: the owner's
    // last session out drops its live clock beside the record eviction). So
    // hearth_key.ts may not delete, state.ts may not set, and nothing clears.
    const roots = ['server', 'src/sim', 'src/net', 'src/game', 'src/ui', 'src/render', 'headless'];
    const setter = join(__dirname, '..', 'src', 'sim', 'freehold', 'hearth_key.ts');
    const evictor = join(__dirname, '..', 'src', 'sim', 'freehold', 'state.ts');
    const reached = new Set<string>();
    for (const root of roots) {
      for (const { full } of tsFilesUnder(join(__dirname, '..', root))) {
        const text = stripComments(readFileSync(full, 'utf8'));
        expect(clockMapEscapes(text, full === setter, full === evictor), full).toEqual([]);
        reached.add(full);
      }
    }
    // Both exempted files were reached, so neither exemption is a dead branch,
    // and the walk is the whole tree, not one stray directory.
    expect(reached.has(setter)).toBe(true);
    expect(reached.has(evictor)).toBe(true);
    expect(reached.size).toBeGreaterThan(100);
  });

  it('refuses every way around the verb rule, so the scan is not textual luck', () => {
    // An alias, an optional chain, a bracket call and a bare hand-off each
    // reach the Map without spelling `.set(` or `.delete(` after its name.
    const escapes = [
      'const m = ctx.freeholdKeyReadyAtMs; m.set(k, 1);',
      'ctx.freeholdKeyReadyAtMs?.set(k, 1);',
      "ctx.freeholdKeyReadyAtMs['delete'](k);",
      'install(ctx.freeholdKeyReadyAtMs);',
      'ctx.freeholdKeyReadyAtMs.clear();',
      'ctx.freeholdKeyReadyAtMs . set(k, 1);',
      'const leak = () => { return ctx.freeholdKeyReadyAtMs; };',
      'function leak() { return host.freeholdKeyReadyAtMs; }',
    ];
    for (const text of escapes) expect(clockMapEscapes(text, false, false), text).not.toEqual([]);
    // The sanctioned shapes pass: reads, the declarations and the forwarding getters.
    const allowed = [
      'const r = ctx.freeholdKeyReadyAtMs.get(k) ?? 0;',
      'if (ctx.freeholdKeyReadyAtMs.has(k) || ctx.freeholdKeyReadyAtMs.size === 0) return;',
      'readonly freeholdKeyReadyAtMs: Map<string, number>;',
      'freeholdKeyReadyAtMs = new Map<string, number>();',
      'get freeholdKeyReadyAtMs() { return host.freeholdKeyReadyAtMs; }',
    ];
    for (const text of allowed) expect(clockMapEscapes(text, false, false), text).toEqual([]);
    expect(clockMapEscapes('ctx.freeholdKeyReadyAtMs.set(k, 1);', true, false)).toEqual([]);
    expect(clockMapEscapes('ctx.freeholdKeyReadyAtMs.delete(k);', false, true)).toEqual([]);
    expect(clockMapEscapes('ctx.freeholdKeyReadyAtMs.delete(k);', true, false)).not.toEqual([]);
    expect(clockMapEscapes('ctx.freeholdKeyReadyAtMs.set(k, 1);', false, true)).not.toEqual([]);
  });

  it('names every sanctioned writer, so the claim is not vacuous', () => {
    const src = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'sim', 'freehold', 'hearth_key.ts'), 'utf8'),
    );
    expect(src.match(/freeholdKeyReadyAtMs\.set\(/g) ?? []).toHaveLength(2);
    expect(src).toContain('export function useHearthKey');
    expect(src).toContain('export function mergeFreeholdKeyReadyAt');
    // THE EVICTOR, exactly one delete, and inside the leave hook's own body.
    const state = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'sim', 'freehold', 'state.ts'), 'utf8'),
    );
    expect(state.match(/freeholdKeyReadyAtMs\s*\.delete\(/g) ?? []).toHaveLength(1);
    const start = state.indexOf('export function releaseFreeholdOnLeave(');
    expect(start).toBeGreaterThan(-1);
    const next = state.indexOf('\nexport ', start + 1);
    const body = state.slice(start, next < 0 ? state.length : next);
    expect(body.split('ctx.freeholdKeyReadyAtMs.delete(key);').length - 1).toBe(1);
  });
});

describe('every durable field write bumps the record revision', () => {
  // THE COUPLING THE PERIODIC SWEEP DEPENDS ON. server/freehold_persist.ts
  // detects a moved record by comparing the live record's `rev` against the
  // last written one, and it is the ONLY dirty detector that runs in this
  // build: markDirty and save have no production caller. So a future mutator
  // that writes `layout`, `trophies`, `tier`, `condition` or `visitPolicy`
  // WITHOUT bumping `rev` is invisible to the sweep, every edit it makes is
  // silently lost at logout, and oldest_dirty_age_ms reads 0 the whole time
  // because the entry never became dirty.
  //
  // Cheap to pin here, expensive to discover from a player's missing
  // furnishings, which is why it is pinned before the furnishing writer lands
  // rather than after.
  // EVERY field a durable row carries, plotId included: the named next change to
  // this directory is a plotId write (teaching a live record its minted identity
  // at install), and a scan that cannot see it would let that writer land
  // without forcing the decision about whether an identity adoption bumps the
  // revision.
  const DURABLE_FIELDS = [
    'layout',
    'trophies',
    'tier',
    'condition',
    'visitPolicy',
    'plotId',
  ] as const;
  // The fields of a durable ROW, reached through `layout` or `trophies`. A
  // mutator that moves one furnishing writes none of the names above: it edits a
  // row already inside the array. `moveFurnishing` is reserved in commands.ts
  // and that is exactly its shape.
  const DURABLE_ROW_FIELDS = ['x', 'y', 'z', 'yaw', 'itemId', 'placementId', 'plinth', 'trophyId'];

  // ONE DEFINITION, used by the scan below AND by the control table beside it.
  // Declaring the predicates twice made the control a test of its own copy: an
  // edit that narrowed the real detector would leave the table green, which is
  // the exact failure the table exists to prevent.
  const ARRAY_MUTATORS = String.raw`\.(?:push|splice|pop|shift|unshift|sort|reverse|fill|copyWithin)\(`;
  /** True when a body writes a field a durable row carries, by any shape. */
  const writesDurableField = (body: string): boolean =>
    DURABLE_FIELDS.some((field) =>
      new RegExp(
        String.raw`\.${field}\s*(?:=[^=]|[-+*/]=|${ARRAY_MUTATORS}|\[[^\]]*\]\s*=[^=])`,
      ).test(body),
    ) ||
    // A row reached THROUGH one of the two arrays, then written.
    (/\.(?:layout|trophies)\b/.test(body) &&
      DURABLE_ROW_FIELDS.some((field) =>
        new RegExp(String.raw`\.${field}\s*(?:=[^=]|[-+*/]=)`).test(body),
      )) ||
    /Object\.assign\(\s*(?:state|record|live|plot)\b/.test(body);
  /** True when a body ADVANCES a record's revision, rather than merely assigning
   *  something called rev. */
  const advancesRevision = (body: string): boolean =>
    /\.rev\s*(?:\+\+|\+= 1|= [^=;]*\.rev\s*\+)/.test(body);

  /**
   * Exported function bodies across the WHOLE directory, comments stripped,
   * keyed by `file:name`.
   *
   * The directory rather than state.ts alone, which is where this scan started
   * and where it was already too narrow. commands.ts holds eight inert bodies
   * explicitly reserved for the furnishing writers, so the one file the next
   * mutator is going to land in was the one file the coupling was not checked
   * in. The `.tier =` sole-writer scan in tests/freehold_dev_grant.test.ts
   * already walks this directory; this now matches it.
   */
  function exportedBodies(): Map<string, string> {
    const dir = join(__dirname, '..', 'src', 'sim', 'freehold');
    const bodies = new Map<string, string>();
    // RECURSIVE: a module added under a subdirectory was invisible to the walk
    // entirely, and the directory listing pin below would only red on the new
    // directory NAME, which the cheapest response is to add to the list.
    const tsFiles = (root: string, prefix = ''): string[] =>
      readdirSync(root, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? tsFiles(join(root, entry.name), `${prefix}${entry.name}/`)
            : entry.name.endsWith('.ts')
              ? [`${prefix}${entry.name}`]
              : [],
        )
        .sort();
    for (const file of tsFiles(dir)) {
      const src = stripComments(readFileSync(join(dir, ...file.split('/')), 'utf8'));
      // EVERY exported callable shape, not `export function` alone: an
      // `export const f = () => {}` or an `export async function` mutator was
      // invisible to this walk entirely.
      const starts = [...src.matchAll(/^export (?:async function|function|const) (\w+)\s*[(=]/gm)];
      for (let i = 0; i < starts.length; i++) {
        const from = starts[i].index ?? 0;
        const next = i + 1 < starts.length ? (starts[i + 1].index ?? src.length) : src.length;
        // TO ITS OWN CLOSING BRACE, not to the next export. A slice that ran to
        // the next export made an exempted CONSTRUCTOR exempt every private
        // helper that followed it: `defaultFreeholdState` swallowed
        // `cloneFreeholdState`, which runs on every load and every serialize,
        // and `freeholdStateFromPersisted` swallowed the canonical JSON encoder.
        // The remainder is kept as its own body so nothing falls out of the scan.
        const body = src.slice(from, next);
        const close = body.indexOf('\n}');
        const end = close === -1 ? body.length : close + 2;
        bodies.set(`${file}:${starts[i][1]}`, body.slice(0, end));
        const rest = body.slice(end);
        if (rest.trim().length > 0) bodies.set(`${file}:${starts[i][1]} <tail>`, rest);
      }
      // The file's HEAD, everything above its first export, so a module-private
      // helper declared before them is not in no body at all. persisted.ts's
      // first export is four hundred lines in. Its <tail> siblings above do the
      // same for a helper declared BETWEEN two exports.
      const head = starts.length > 0 ? src.slice(0, starts[0].index ?? 0) : src;
      if (head.trim().length > 0) bodies.set(`${file}:<module head>`, head);
    }
    return bodies;
  }

  /** The bodies keyed by bare name, for the cases that name one function. KEYED
   *  BY `file:name`, because a suffix match returns the FIRST file that exports
   *  the name and two files exporting one name would silently collapse onto
   *  whichever sorts first. */
  function bodyOf(name: string): string {
    const exact = [...exportedBodies()].filter(([key]) => key.endsWith(`:${name}`));
    expect(exact.length, `exactly one export named ${name}`).toBe(1);
    return exact[0][1];
  }

  it('finds the exported functions it means to check', () => {
    // Anti-vacuity for the scanner: an extractor that silently matched nothing
    // would pass this whole block forever.
    const bodies = exportedBodies();
    // The directory, not one file: the count is well past state.ts's own, and
    // the reserved furnishing writers in commands.ts are inside it.
    // Tight enough to notice the scan silently losing a file: the directory
    // exports 43 bodies today, and a bound of 20 would survive losing half of
    // them. The two key pins below are the real control; this is the coarse one.
    // EVERY .ts FILE IN THE DIRECTORY is represented, which a numeric floor
    // cannot say: a floor of 40 against 43 tolerated losing three single-export
    // files outright.
    // LISTED THE WAY THE WALK WALKS, recursively. The walk above was widened to
    // recurse in this same range while this listing stayed flat, so the moment a
    // module lands under a subdirectory the two disagree and the disagreement
    // reads as a missing file rather than as a stale pin.
    const scanned = new Set([...bodies.keys()].map((key) => key.split(':')[0]));
    const listTs = (root: string, prefix = ''): string[] =>
      readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? listTs(join(root, entry.name), `${prefix}${entry.name}/`)
          : entry.name.endsWith('.ts')
            ? [`${prefix}${entry.name}`]
            : [],
      );
    const onDisk = listTs(join(__dirname, '..', 'src', 'sim', 'freehold')).sort();
    expect([...scanned].sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(10);
    expect(bodies.size).toBeGreaterThanOrEqual(40);
    expect(bodies.has('state.ts:setFreeholdTier')).toBe(true);
    expect(bodies.has('commands.ts:placeFurnishing')).toBe(true);
    expect(bodyOf('setFreeholdTier')).toContain('state.tier = tier');
    // The walk really does reach an arrow export and a module head, so the two
    // widenings above are not decoration.
    expect(bodies.has('persisted.ts:<module head>')).toBe(true);
  });

  it('is the ONLY file that writes the live record map, as its header claims', () => {
    // src/sim/freehold/state.ts states "THIS IS THE ONLY FILE THAT WRITES
    // ctx.freeholds". The Hearth clock map gets a seven-root scan with a named
    // exemption; the record map, which the whole write seal reasons about, had
    // none, so a `ctx.freeholds.set(key, { ...record, layout: [] })` added in
    // sim.ts was invisible to every scan in the tree.
    // THE WHOLE OF src/, not seven hand-listed roots. The list omitted
    // src/world_api, src/editor, src/admin, src/guide and src/main.ts itself,
    // and the claim it enforces is "the ONLY file", not "the only file in seven
    // directories": the seam interface and the editor's viewport both hold a
    // SimContext, so either could set the map and no scan in the tree would see
    // it. `src` is walked whole and every root the claim covers is named.
    const roots = ['server', 'src', 'headless', 'bot'];
    const offenders: string[] = [];
    const SOLE_WRITER = /freeholds\s*\.\s*(?:set|delete|clear)\s*\(/;
    const walk = (root: string): void => {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (full.endsWith(join('src', 'sim', 'freehold', 'state.ts'))) continue;
        const src = stripComments(readFileSync(full, 'utf8'));
        if (SOLE_WRITER.test(src)) offenders.push(full);
      }
    };
    for (const root of roots) walk(join(__dirname, '..', root));
    expect(offenders).toEqual([]);
    // ANTI-VACUITY, THROUGH THE SCAN'S OWN PREDICATE. The control used to assert
    // two LITERALS while the scan used a regex, so a regex that stopped matching
    // anything passed the offender list empty and the control went green
    // regardless: it controlled the file's contents, not the detector. Running
    // SOLE_WRITER over the exempt file is what makes it a control.
    const owner = stripComments(
      readFileSync(join(__dirname, '..', 'src', 'sim', 'freehold', 'state.ts'), 'utf8'),
    );
    expect(SOLE_WRITER.test(owner)).toBe(true);
    // And the walker really walked: the exempt file is the one path it skipped,
    // so it has to have been visited to be skipped.
    expect(owner.split('ctx.freeholds.set(').length - 1).toBe(2);
    expect(owner.split('ctx.freeholds.delete(').length - 1).toBe(1);
  });

  it('bumps rev in the same function as any durable field write', () => {
    // The two functions that legitimately write durable fields WITHOUT a bump:
    // one builds the record from nothing and the other installs a record read
    // off the durable row, and in both cases the revision arrives with the
    // document rather than being advanced past it. Anything else is a mutator.
    const CONSTRUCTORS = new Set([
      'state.ts:defaultFreeholdState',
      'persisted.ts:freeholdStateFromPersisted',
      'persisted.ts:persistedFreeholdFromState',
    ]);
    // AND THE EXEMPTION IS PINNED, not asserted. Each of the three builds a
    // record from nothing or from a durable document, so the revision arrives
    // WITH the document rather than being advanced past it. A body that stopped
    // being a constructor and stayed on this list would carry the exemption with
    // it, so each one has to still return a freshly built record.
    // AND ONLY THE EXPORT ITSELF IS EXEMPT: its trailing private helpers are
    // scanned under a `<tail>` key, so the exemption cannot widen silently.
    for (const name of CONSTRUCTORS) {
      expect([...exportedBodies().keys()], `${name} still exists`).toContain(name);
      const body = exportedBodies().get(name) ?? '';
      expect(body, `${name} is on the constructor exemption list`).not.toBe('');
      expect(body, `${name} builds a record rather than mutating one`).toMatch(/return\s*\{/);
      expect(body, `${name} takes no live record from the context`).not.toContain(
        'ctx.freeholds.get(',
      );
    }
    for (const [name, body] of exportedBodies()) {
      if (CONSTRUCTORS.has(name)) continue;
      // THE ASSIGNMENT TARGET, not the field name alone. The old detector
      // matched `.layout =` and four array methods on the field itself, so nine
      // realistic mutator shapes wrote a durable field and read as clean: an
      // in-place row edit, an indexed write, a compound assignment, unshift,
      // sort, reverse, fill, a length truncation and Object.assign onto the
      // record. `moveFurnishing`, reserved in commands.ts, is the first of those
      // and the seal's third arm rests on this coupling.
      if (!writesDurableField(body)) continue;
      // AN ADVANCE, not any assignment. `= ` alone was satisfied by
      // `const rev = state.rev`, by `state.rev = 0` and by any local named rev,
      // so a mutator that RESET the revision passed the coupling pin.
      expect(advancesRevision(body), `${name} writes a durable field`).toBe(true);
    }
  });

  it('is not vacuous: the one sanctioned mutator today IS caught by the scan', () => {
    const body = bodyOf('setFreeholdTier');
    expect(body).toMatch(/\.tier\s*=[^=]/);
    expect(body).toContain('state.rev += 1');
  });

  it('catches the shapes the next writer will use, and refuses a reset', () => {
    // The detector and the bump matcher, exercised against planted bodies rather
    // than trusted. Every DETECTED shape below wrote a durable field and read as
    // CLEAN under the old predicate, and the two REFUSED bumps below satisfied
    // the old `= ` matcher.
    // THE SCAN'S OWN PREDICATES, not a second copy of them. A control table that
    // declares its own regexes tests the table, and a narrowing edit to the real
    // detector leaves it green.
    const detects = writesDurableField;
    const advances = advancesRevision;

    for (const body of [
      'const row = state.layout.find((r) => r.placementId === id); row.x = x; row.yaw = yaw;',
      'state.layout[i] = next;',
      'state.condition -= wear;',
      'state.layout.unshift(row);',
      'state.layout.sort((a, b) => a.placementId - b.placementId);',
      'state.trophies[0].trophyId = trophyId;',
      'Object.assign(state, { tier: next });',
      'state.plotId = minted;',
    ]) {
      expect(detects(body), `should detect: ${body}`).toBe(true);
    }
    // A body that touches nothing durable is not dragged in.
    expect(detects('const n = state.layout.length; return n;')).toBe(false);
    // The bump has to ADVANCE the record's own revision.
    expect(advances('state.rev += 1')).toBe(true);
    expect(advances('state.rev++')).toBe(true);
    expect(advances('live.rev = state.rev + 1')).toBe(true);
    expect(advances('const rev = state.rev;')).toBe(false);
    expect(advances('state.rev = 0;')).toBe(false);
    expect(advances('state.rev = other.rev;')).toBe(false);
  });
});

describe('src/sim/freehold/ source scan', () => {
  const dir = join(__dirname, '..', 'src', 'sim', 'freehold');
  // Block comments first (a `/*` inside a // comment cannot open a false block),
  // then // line comments, keeping :// protocol slashes (the tests/bank_audit
  // helper).
  const codeOnly = (src: string): string =>
    src.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  // A plain directory listing, not the shared .ts walker: this scan reads
  // CLAUDE.md prose as well as the sources, which tsFilesUnder excludes.
  const files = readdirSync(dir).sort();

  it('covers the whole directory', () => {
    expect(files).toEqual([
      'CLAUDE.md',
      'commands.ts',
      'crafted_availability.ts',
      'dev_grant.ts',
      'entry_context.ts',
      'gate.ts',
      'gate_rules.ts',
      'hearth_key.ts',
      'index.ts',
      'instance.ts',
      'load_report.ts',
      'owner_key.ts',
      'persisted.ts',
      'should_spawn_npc.ts',
      'state.ts',
      'types.ts',
    ]);
  });

  it('names every client file that reaches gate_rules.ts BY PATH, in CLAUDE.md', () => {
    // The client half of the same exhaustive list: derived from every non-sim
    // source under src/, so a new render or UI importer reds until it is named.
    const guide = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const start = guide.indexOf('SECOND, the CLIENT modules');
    const end = guide.indexOf('- Design:', start);
    expect(start, 'the client exception paragraph must be findable').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const paragraph = guide.slice(start, end);
    const src = join(__dirname, '..', 'src');
    // Either quote, an optional extension, a static or dynamic import; a
    // commented-out import is no importer.
    const reaches = /(?:from|import\()\s*(['"])[./]*\/sim\/freehold\/gate_rules(?:\.[jt]s)?\1/;
    const importsGateRules = (text: string) =>
      reaches.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'));
    expect(importsGateRules(`import { x } from "../sim/freehold/gate_rules.ts";`)).toBe(true);
    expect(importsGateRules(`await import('../../sim/freehold/gate_rules')`)).toBe(true);
    expect(importsGateRules(`// import { x } from '../sim/freehold/gate_rules';`)).toBe(false);
    expect(importsGateRules(`/* import { x } from '../sim/freehold/gate_rules'; */`)).toBe(false);
    expect(importsGateRules(`from '../sim/freehold/gate_rules_extra'`)).toBe(false);
    const importers = tsFilesUnder(src)
      .filter(({ file }) => !file.startsWith('sim/'))
      .filter(({ full }) => importsGateRules(readFileSync(full, 'utf8')))
      .map(({ file }) => `src/${file}`)
      .sort();
    expect(importers).toContain('src/render/pick_resolution.ts');
    expect(importers.length).toBeGreaterThan(6);
    for (const importer of importers) expect(paragraph, importer).toContain(`\`${importer}\``);
    // And no name the tree no longer backs.
    const named = [...paragraph.matchAll(/`(src\/(?!sim\/)[a-z_/]+\.ts)`/g)].map((m) => m[1]);
    expect(named.sort()).toEqual(importers);
  });

  it('names every server file that reaches these leaves BY PATH, in CLAUDE.md', () => {
    // The directory's own rule says the exception list is EXHAUSTIVE and that an
    // importer added without a line there is drift by definition, and a prose
    // list with nothing behind it is exactly the claim this packet has shipped
    // wider than its evidence before: it was stale against three importers that
    // three separate extractions added, each of which inherited the exception
    // rather than creating one. DERIVED from the tree, so the next extraction
    // reds this instead of going unnoticed.
    const guide = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const importers = tsFilesUnder(join(__dirname, '..', 'server'))
      .filter(({ full }) => /from '[./]*\/src\/sim\/freehold\//.test(readFileSync(full, 'utf8')))
      .map(({ file }) => `server/${file}`)
      .sort();
    // Anti-vacuity: a walker that found nothing would pass this loop empty.
    expect(importers).toContain('server/freehold_persist.ts');
    expect(importers.length).toBeGreaterThan(5);
    for (const importer of importers) expect(guide, importer).toContain(`\`${importer}\``);

    // AND THE LEAF LIST BESIDE EACH NAME, because naming the file was the half
    // that passed while the prose beside it was wrong: the round that added this
    // pin also credited the store with a `types.ts` import it does not have, and
    // a name-only check is blind to exactly that.
    //
    // SCOPED TO THE EXCEPTION PARAGRAPH, which the first cut of this was not: it
    // searched the WHOLE guide, found each file's earliest mention (which is
    // ordinary prose hundreds of characters from any list), and skipped it as
    // list-less. Every importer was silently exempt and the pin passed over the
    // false claim it was written for. The window is asserted below so a rewrite
    // that moves the paragraph reds instead of emptying the check.
    const first = guide.indexOf('FIRST, the SERVER');
    const second = guide.indexOf('SECOND, the CLIENT modules');
    expect(first, 'the server exception paragraph must be findable').toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // Whitespace collapsed, so a list the prose WRAPS onto the next line is
    // still the list right after its name: the earlier adjacency test counted
    // raw characters, and every wrapped list was skipped as list-less, which is
    // how a missing `owner_key.ts` passed.
    const paragraph = guide.slice(first, second).replace(/\s+/g, ' ');
    const realLeaves = (importer: string) =>
      [
        ...new Set(
          [
            ...readFileSync(importer, 'utf8').matchAll(
              /from '[./]*\/src\/sim\/freehold\/([a-z_]+)'/g,
            ),
          ].map((m) => m[1]),
        ),
      ].sort();
    // The ONE importer the paragraph describes in prose rather than with a
    // list, and the prose says which leaf: held to that claim instead.
    const PROSE = new Map([['server/game.ts', ['gate_rules']]]);
    let checked = 0;
    for (const importer of importers) {
      const name = `\`${importer}\``;
      const at = paragraph.indexOf(name);
      expect(at, `${importer} is not named in the server exception paragraph`).toBeGreaterThan(-1);
      const after = paragraph.slice(at + name.length);
      const prose = PROSE.get(importer);
      if (prose) {
        expect(after.startsWith(' ('), `${importer} is described in prose`).toBe(false);
        expect(realLeaves(importer), `${importer} reaches more than its prose says`).toEqual(prose);
        continue;
      }
      // No skip: every other importer carries its list right after its name.
      expect(after.startsWith(' ('), `${importer} must carry its leaf list after its name`).toBe(
        true,
      );
      const close = after.indexOf(')');
      expect(close, `${importer}'s leaf list is never closed`).toBeGreaterThan(0);
      const claimed = [
        ...new Set([...after.slice(0, close).matchAll(/`([a-z_]+)\.ts`/g)].map((m) => m[1])),
      ].sort();
      expect(claimed, `${importer}: the guide's leaf list against its real imports`).toEqual(
        realLeaves(importer),
      );
      checked += 1;
    }
    // Every importer was compared: a list or the one prose claim, never a skip.
    expect(checked).toBe(importers.length - PROSE.size);
  });

  it('carries no store or ledger-service vocabulary in any file, comments included', () => {
    const banned = /wallet|token|\$WOC|\bmint\b|holder|marketplace|on-chain|solana/i;
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text.match(banned)?.[0] ?? null, f).toBeNull();
    }
  });

  it('reads no wall clock and draws nothing outside Rng in any code line', () => {
    const banned = /Math\.random|Date\.now|performance\.now|\.rng\b/;
    for (const f of files.filter((n) => n.endsWith('.ts'))) {
      const code = codeOnly(readFileSync(join(dir, f), 'utf8'));
      // Anti-vacuity: the stripper left real code behind, so an over-eager
      // regex cannot turn this scan into a pass over an empty string.
      expect(code, f).toContain('export ');
      expect(code.match(banned)?.[0] ?? null, f).toBeNull();
    }
  });

  it('imports Sim nowhere: the modules see the SimContext seam and nothing past it', () => {
    // The other half of the SimContext contract, which the clock/rng scan above
    // does not cover: a module behind the seam must not import Sim concretely
    // or reach past ctx into Sim internals. Both modules are type-only on
    // SimContext today; this holds that line as the bodies land.
    const simImport = /from\s+['"][^'"]*\/sim(?:\.js)?['"]|\bimport\b[^;]*\bSim\b/;
    for (const f of files.filter((n) => n.endsWith('.ts'))) {
      const code = codeOnly(readFileSync(join(dir, f), 'utf8'));
      const importLines = code
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import'))
        .join('\n');
      expect(importLines.match(simImport)?.[0] ?? null, f).toBeNull();
    }
    // The scan's own edge: a real Sim import WOULD be caught, so widening the
    // regex cannot quietly make this vacuous.
    expect("import type { Sim } from '../sim';".match(simImport)).not.toBeNull();
    expect("import type { SimContext } from '../sim_context';".match(simImport)).toBeNull();
  });

  // The three sibling housing modules outside src/sim/ (the facet, the client
  // decode home, the server guard) carry the same vocabulary risk and are
  // scanned as TEXT, never imported. `token` is also the house word for a wire
  // command name and a rate-limit unit, so that idiom is stripped first and
  // only the bare (store) sense stays banned. A bare `housing token` is
  // deliberately NOT exempt: that is the exact phrase a store-flavored line
  // would use, so a sibling meaning the wire sense says `housing wire token`.
  it('keeps the three sibling housing modules free of the same vocabulary', () => {
    const banned = /wallet|token|\$WOC|\bmint\b|holder|marketplace|on-chain|solana/i;
    const wireIdiom = /\b(?:wire|lane|command|command-lane) tokens?\b|\btoken-set\b/gi;
    // The allowlist's own edges, so a widened alternation cannot quietly turn
    // this scan vacuous: the wire phrasing is exempt, the bare phrase is not.
    expect('the ten housing wire tokens and the token-set'.replace(wireIdiom, '')).not.toMatch(
      banned,
    );
    expect('bought with a housing token'.replace(wireIdiom, '')).toMatch(banned);
    // A second banned dimension, so widening the alternation to another word
    // (say `|wallet`) cannot exempt it while the token probes stay green.
    expect('a wallet balance'.replace(wireIdiom, '')).toMatch(banned);
    const siblings = [
      join(__dirname, '..', 'src', 'world_api', 'housing.ts'),
      join(__dirname, '..', 'src', 'net', 'freehold_snapshot_wire.ts'),
      join(__dirname, '..', 'server', 'freehold_wire.ts'),
    ];
    for (const f of siblings) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).toContain('export ');
      expect(text.replace(wireIdiom, '').match(banned)?.[0] ?? null, f).toBeNull();
    }
  });
});
