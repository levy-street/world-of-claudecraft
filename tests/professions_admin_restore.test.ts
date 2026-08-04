// The R35 GM slot restore (restoreToolEffectSlotAction): a server-admin-only
// mint that installs a tool-effect slot WITHOUT consuming a charm. The claims
// under test: the restored slot is byte-identical to what the real charm mint
// would install minus provenance (craftedBy unset), every refusal arm the real
// mint has still refuses (bad profession, bad effect, refused pair, no tool
// owned), a refusal leaves the parity-load-bearing ABSENCE of the
// toolEffectSlots field untouched, and the player-visible success event fires
// so a live client sees the restore land.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { restoreToolEffectSlotAction } from '../src/sim/professions/tool_effect_actions';
import { resolveSlotToolEffect, startingDurabilityFor } from '../src/sim/professions/tools';
import { type PlayerMeta, Sim } from '../src/sim/sim';

const makeSim = (seed = 11) => new Sim({ seed, playerClass: 'warrior', autoEquip: false });
const metaOf = (sim: Sim): PlayerMeta => sim.meta(sim.playerId) as PlayerMeta;

function toolEffectEvents(sim: Sim): Array<Record<string, unknown>> {
  return sim.tick().filter((ev) => ev.type === 'toolEffectResult') as unknown as Array<
    Record<string, unknown>
  >;
}

describe('restoreToolEffectSlotAction (GM restore, R35)', () => {
  it('mints a full-charge slot with no charm in bags, sized by the owned tool rarity', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1); // tier 1, common; NO charm granted
    const result = restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', sim.playerId);
    expect(result).toBe('ok');
    const slot = metaOf(sim).toolEffectSlots?.mining;
    expect(slot).toBeDefined();
    expect(slot?.effectId).toBe('gatherers_cache');
    const full = startingDurabilityFor('gatherers_cache', 'common');
    expect(full).toBe(20); // the literal, so this file is not a self-comparison
    expect(slot?.durability).toBe(full);
    expect(slot?.maxDurability).toBe(full);
    expect(slot?.confirmMode).toBe('always');
    expect(slot?.craftedBy).toBeUndefined(); // no consumed copy, no provenance
    // The player sees the restore land: the normal slot success event.
    const events = toolEffectEvents(sim);
    expect(events).toContainEqual(
      expect.objectContaining({ action: 'slot', ok: true, professionId: 'mining' }),
    );
  });

  it('sizes charges by the BEST owned tool, like the real mint (epic pick)', () => {
    const sim = makeSim();
    sim.addItem('arcanite_mining_pick', 1); // tier 5, epic
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', sim.playerId)).toBe(
      'ok',
    );
    const slot = metaOf(sim).toolEffectSlots?.mining;
    // The epic rung as a LITERAL (20 base charges plus one
    // RARITY_DURABILITY_BONUS of 10 per rung above common, epic being the
    // third), so this is a pin and not the production helper compared against
    // itself; 20 is the common rung pinned above.
    expect(slot?.maxDurability).toBe(50);
    expect(slot?.maxDurability).toBeGreaterThan(20);
  });

  it('matches the real charm mint field-for-field except provenance', () => {
    // Real mint on sim A (consumes a self-signed charm), restore on sim B
    // (same tool, no charm). Any divergence beyond craftedBy is drift between
    // the two mint paths.
    const real = makeSim();
    real.addItem('copper_mining_pick', 1);
    real.addItemInstance('gatherers_cache', { signer: metaOf(real).name }, real.playerId, 1);
    real.slotToolEffect('mining', 'gatherers_cache');
    const restored = makeSim();
    restored.addItem('copper_mining_pick', 1);
    restoreToolEffectSlotAction(restored.ctx, 'mining', 'gatherers_cache', restored.playerId);
    const realSlot = { ...metaOf(real).toolEffectSlots?.mining };
    const restoredSlot = { ...metaOf(restored).toolEffectSlots?.mining };
    expect(realSlot.craftedBy).toBe(metaOf(real).name);
    realSlot.craftedBy = undefined;
    expect(restoredSlot).toEqual(realSlot);
  });

  it('refuses with no_tool when the character owns no tool for the profession', () => {
    const sim = makeSim(); // bare hands
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', sim.playerId)).toBe(
      'no_tool',
    );
    // Absence, not emptiness: a refusal must not materialize the field (the
    // parity digest hashes the player and an empty object still serializes).
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
    expect(toolEffectEvents(sim)).toHaveLength(0); // a GM refusal never toasts the player
  });

  it('refuses invalid professions, invalid effects, and REFUSED PAIRS', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItem('ironreel_fishing_rod', 1);
    // Not a gathering profession at all.
    expect(restoreToolEffectSlotAction(sim.ctx, 'cooking', 'gatherers_cache', sim.playerId)).toBe(
      'invalid_request',
    );
    // Not a TOOL_EFFECTS key (the display name "Springback Charm" belongs to
    // quickening_charm; a fabricated id must hit the unknown-effect arm).
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'not_an_effect', sim.playerId)).toBe(
      'invalid_request',
    );
    // REFUSED PAIRS, the slotToolEffectRefused policy line itself: both ids
    // are individually valid, so only the pair policy can refuse these. A
    // Springback (quickening_charm) slot is policy-refused everywhere, and
    // fishing (a real gathering profession, rod owned) accepts no effect.
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'quickening_charm', sim.playerId)).toBe(
      'invalid_request',
    );
    expect(restoreToolEffectSlotAction(sim.ctx, 'fishing', 'gatherers_cache', sim.playerId)).toBe(
      'invalid_request',
    );
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
  });

  // The one-mint-authority drift pin. `resolveSlotToolEffect` carries the
  // banner naming it THE ONE MINT AUTHORITY, so no path can mint what another
  // path refuses; the restore is the single arm that does not call it and
  // re-implements the gates the two mints share. This matrix feeds one fixture
  // to BOTH and demands the same answer tuple-for-tuple, so a divergence in
  // any gate these fixtures reach (membership, effect existence, the refused
  // pair, the ownership scan) reddens HERE rather than shipping as a
  // free-grant hole; a future shared gate no fixture trips needs its own row.
  //
  // Each fixture isolates a SHARED gate on purpose: the charm the real mint
  // consumes is in bags whenever the effect has one (Springback has no item
  // by design), so the resolver's no_charm arm can never stand in for a shared
  // refusal; confirmMode is 'always' and the live slot is undefined, so its
  // confirm-mode and no_gain arms cannot fire; and every tuple gets a fresh
  // sim, so the restore's own already_slotted arm cannot fire either.
  it('agrees with the one mint authority (resolveSlotToolEffect) on every shared gate', () => {
    const matrix: Array<{
      what: string;
      professionId: string;
      effectId: string;
      bags: string[];
      expected: 'ok' | 'invalid_request' | 'no_tool';
    }> = [
      {
        what: 'gate 1, not a gathering profession',
        professionId: 'cooking',
        effectId: 'gatherers_cache',
        bags: ['copper_mining_pick', 'gatherers_cache'],
        expected: 'invalid_request',
      },
      {
        what: 'gate 2, effect absent from the catalog',
        professionId: 'mining',
        effectId: 'not_an_effect',
        bags: ['copper_mining_pick', 'gatherers_cache'],
        expected: 'invalid_request',
      },
      {
        what: 'gate 3, the refused pair policy (respawnSpeed everywhere)',
        professionId: 'mining',
        effectId: 'quickening_charm',
        bags: ['copper_mining_pick'],
        expected: 'invalid_request',
      },
      {
        what: 'gate 3, the refused pair policy (every effect on fishing)',
        professionId: 'fishing',
        effectId: 'gatherers_cache',
        bags: ['ironreel_fishing_rod', 'gatherers_cache'],
        expected: 'invalid_request',
      },
      {
        what: 'gate 4, no tool owned for the profession',
        professionId: 'mining',
        effectId: 'gatherers_cache',
        bags: ['gatherers_cache'],
        expected: 'no_tool',
      },
      {
        what: 'every gate passed',
        professionId: 'mining',
        effectId: 'gatherers_cache',
        bags: ['copper_mining_pick', 'gatherers_cache'],
        expected: 'ok',
      },
      {
        what: 'every gate passed, a second effect',
        professionId: 'mining',
        effectId: 'artisans_eye',
        bags: ['copper_mining_pick', 'artisans_eye'],
        expected: 'ok',
      },
    ];
    const actual: string[] = [];
    const expected: string[] = [];
    for (const row of matrix) {
      const sim = makeSim();
      for (const itemId of row.bags) sim.addItem(itemId, 1);
      const meta = metaOf(sim);
      // The real mint's decision, read off the SAME bags, before the restore
      // mutates anything.
      const resolved = resolveSlotToolEffect(
        meta.inventory,
        row.professionId,
        row.effectId,
        'always',
        ITEMS,
        meta.name,
        undefined,
      );
      const mint = resolved.ok ? 'ok' : resolved.reason;
      const restore = restoreToolEffectSlotAction(
        sim.ctx,
        row.professionId,
        row.effectId,
        sim.playerId,
      );
      actual.push(`${row.what}: mint=${mint} restore=${restore}`);
      // Pinned to the literal on BOTH sides, not just to each other: deleting
      // the same gate from both arms would still agree, and must still fail.
      expected.push(`${row.what}: mint=${row.expected} restore=${row.expected}`);
    }
    expect(actual).toEqual(expected);
  });

  it('refuses to OVERWRITE an intact slot (already_slotted preserves the live row)', () => {
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('artisans_eye', { signer: metaOf(sim).name }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'artisans_eye', 'prompt');
    const before = { ...metaOf(sim).toolEffectSlots?.mining };
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', sim.playerId)).toBe(
      'already_slotted',
    );
    // The live row keeps its provenance, confirm mode, and ceiling untouched.
    expect(metaOf(sim).toolEffectSlots?.mining).toEqual(before);
  });

  it('already_slotted outranks no_tool: the ORDER of the refusals is deliberate', () => {
    // A character with a live slot but NO tool must hear "already slotted",
    // not "no tool": the live row is the reason a restore is wrong, and the
    // two arms produce different operator-facing prose. Swapping the checks
    // is the refactor this pin exists to catch.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: metaOf(sim).name }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    sim.removeItem('copper_mining_pick', 1, sim.playerId);
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', sim.playerId)).toBe(
      'already_slotted',
    );
  });

  it('refuses offline (unresolvable) pids without touching anything', () => {
    const sim = makeSim();
    expect(restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', 424242)).toBe(
      'offline',
    );
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
    expect(toolEffectEvents(sim)).toHaveLength(0);
  });

  it('refuses a non-finite pid instead of falling back to the PRIMARY entity', () => {
    // `ctx.resolve(undefined)` and `ctx.resolve(null)` resolve the sim's
    // primary entity, so without the explicit guard an omitted pid (the type
    // says required, the server is JavaScript at runtime) would aim a
    // charm-free mint at whoever that is: undefined and null are the two
    // mutation-killing values here (NaN/Infinity already missed the map
    // lookup before the guard existed and ride along for coverage). The tool
    // is in bags, so every other gate passes for the primary.
    const sim = makeSim();
    sim.addItem('copper_mining_pick', 1);
    for (const pid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        restoreToolEffectSlotAction(sim.ctx, 'mining', 'gatherers_cache', pid as unknown as number),
      ).toBe('offline');
    }
    expect(metaOf(sim).toolEffectSlots).toBeUndefined();
    expect(toolEffectEvents(sim)).toHaveLength(0);
  });

  it('is draw-free: a restore between ticks never moves the rng stream', () => {
    // Two sims from one seed; only one takes a restore between ticks. The
    // per-draw observer counts every draw the restore makes (must be zero),
    // and the streams must stay in lockstep across subsequent ticks: any
    // draw inside the restore path desynchronizes every later value.
    const a = makeSim(77);
    const b = makeSim(77);
    for (const sim of [a, b]) {
      sim.addItem('copper_mining_pick', 1);
      sim.tick();
    }
    let draws = 0;
    b.rng.setObserver(() => {
      draws += 1;
    });
    expect(restoreToolEffectSlotAction(b.ctx, 'mining', 'gatherers_cache', b.playerId)).toBe('ok');
    b.rng.setObserver(null);
    expect(draws).toBe(0);
    for (let i = 0; i < 20; i++) {
      a.tick();
      b.tick();
    }
    for (let i = 0; i < 8; i++) expect(b.rng.next()).toBe(a.rng.next());
  });

  it('stays unreachable from every player path: server/game.ts is the only importer', () => {
    // The free-grant incident guard: a future wire command, dev command, or
    // IWorld wiring that imports the restore must fail HERE, loudly. Walks
    // the real source tree (the repo's source-scan guard idiom), not a
    // hardcoded list of suspects.
    const root = fileURLToPath(new URL('..', import.meta.url));
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // `.svelte` included on purpose: the admin dashboard is Svelte, and a
        // component reaching the sim action directly would be exactly the
        // player-unreachable-only claim breaking.
        else if (/\.(ts|mts|cts|tsx|js|mjs|cjs|svelte)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (
            text.includes('restoreToolEffectSlotAction') &&
            !full.endsWith(path.join('professions', 'tool_effect_actions.ts'))
          ) {
            importers.push(path.relative(root, full).split(path.sep).join('/'));
          }
        }
      }
    };
    // The roots are DERIVED from the repo, not listed: a hardcoded list is a
    // guard that silently stops covering the next top-level source directory
    // somebody adds. Everything not on the denylist below is walked.
    //
    // `tests` is excluded deliberately (this file names the identifier, and so
    // may any future test); the rest are dependencies, build output, vendored
    // or generated trees, packaging assets, and non-code content, plus
    // ip-refactor (a server-internal tooling tree that never rides a bundle).
    // `private` IS walked: it is in the tsconfig include and hosts the
    // bot-detector alias, so an import from there must trip the guard.
    const NON_SOURCE_ROOTS = new Set([
      'node_modules',
      'tests',
      'docs',
      'public',
      'mediawiki',
      'deploy',
      'android',
      'ios',
      'build',
      'third_party',
      'screenshots',
      'skies_in',
      'ip-refactor',
      'tmp',
    ]);
    const roots = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('dist') && // dist, dist-env, dist-server: bundled output
          !NON_SOURCE_ROOTS.has(entry.name),
      )
      .map((entry) => entry.name);
    // The derivation may only WIDEN: a denylist typo that dropped one of the
    // original six roots would quietly stop guarding a real source tree.
    for (const required of ['src', 'server', 'headless', 'bot', 'scripts', 'electron']) {
      expect(roots).toContain(required);
    }
    for (const top of roots) walk(path.join(root, top));
    expect(importers).toEqual(['server/game.ts']);
  });
});
