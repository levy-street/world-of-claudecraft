import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_PREWARM_SETS,
  type EncounterPrewarmSet,
  encounterPrewarmDisabled,
  encounterPrewarmForInterior,
  encounterPrewarmSpecForSets,
  INTERIOR_ENCOUNTER_PREWARM,
  unclaimedEncounterPrewarmSets,
} from '../src/render/interior_encounter_prewarm';
import { DUNGEONS } from '../src/sim/data';
import { IGNIVAR_LIFT_ROOM_ID, IGNIVAR_RAID_ROOM_IDS } from '../src/sim/ignivar_raid_ids';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

// Every source pin below reads the COMMENT-STRIPPED text: a pin that a comment
// can satisfy says nothing about what runs.
const readSource = (path: string): string =>
  codeWithoutLineComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

const NYTHRAXIS_ALDRIC = 'brother_aldric_raid';

describe('interior encounter prewarm spec', () => {
  it('warms every Varkhul and Ignivar encounter material before entering the Inner Crucible', () => {
    const spec = INTERIOR_ENCOUNTER_PREWARM.ignivar_depths;
    expect(spec).toEqual({ varkhulVisuals: true, ignivarVisuals: true });
    expect(encounterPrewarmForInterior('ignivar_depths')).toEqual(spec);
  });

  it('warms both raid sets from the Forge-Lift and the Halls, before either boss room', () => {
    for (const interior of ['ignivar_lift', 'ignivar_approach']) {
      const spec = INTERIOR_ENCOUNTER_PREWARM[interior];
      expect(spec).toEqual({ varkhulVisuals: true, ignivarVisuals: true });
      expect(encounterPrewarmForInterior(interior)).toEqual(spec);
    }
  });

  it('claims a set once whichever interior asks, and narrows a spec to the unclaimed sets', () => {
    const lift = INTERIOR_ENCOUNTER_PREWARM.ignivar_lift;
    const claimed = new Set<EncounterPrewarmSet>();
    expect(unclaimedEncounterPrewarmSets(lift, claimed)).toEqual([
      'varkhulVisuals',
      'ignivarVisuals',
    ]);
    claimed.add('varkhulVisuals');
    claimed.add('ignivarVisuals');
    for (const interior of ['ignivar_approach', 'ignivar', 'ignivar_depths']) {
      expect(unclaimedEncounterPrewarmSets(INTERIOR_ENCOUNTER_PREWARM[interior], claimed)).toEqual(
        [],
      );
    }
    // A claim on the raid sets says nothing about the crypt's.
    expect(unclaimedEncounterPrewarmSets(INTERIOR_ENCOUNTER_PREWARM.nythraxis, claimed)).toEqual([
      'nythraxisGraveVisuals',
    ]);

    // Every staged set, one per flag the spec can carry.
    expect([...ENCOUNTER_PREWARM_SETS].sort()).toEqual([
      'ignivarVisuals',
      'nythraxisGraveVisuals',
      'varkhulVisuals',
    ]);
    const depths = INTERIOR_ENCOUNTER_PREWARM.ignivar_depths;
    const onlyIgnivar = encounterPrewarmSpecForSets(depths, ['ignivarVisuals']);
    expect(onlyIgnivar.ignivarVisuals).toBe(true);
    expect(onlyIgnivar.varkhulVisuals).toBe(false);
    for (const set of ENCOUNTER_PREWARM_SETS) {
      expect(encounterPrewarmSpecForSets(depths, [set])[set]).toBe(true);
      expect(encounterPrewarmSpecForSets(depths, [])[set]).toBe(false);
    }
  });

  it('keys every row by an interior some dungeon room declares, the lift first in the raid', () => {
    const interiors = new Set<string>(Object.values(DUNGEONS).map((room) => room.interior));
    const rows = Object.keys(INTERIOR_ENCOUNTER_PREWARM);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) expect(interiors.has(row), row).toBe(true);
    // The rows count on the raid entering through the lift, its quiet room.
    expect(IGNIVAR_RAID_ROOM_IDS[0]).toBe(IGNIVAR_LIFT_ROOM_ID);
    expect(DUNGEONS[IGNIVAR_LIFT_ROOM_ID].interior).toBe('ignivar_lift');
    for (const room of IGNIVAR_RAID_ROOM_IDS) {
      const interior = DUNGEONS[room].interior;
      expect(interior && encounterPrewarmForInterior(interior), room).not.toBeNull();
    }
  });

  it('claims every staged flag a row sets as a set, and nothing else', () => {
    const staged = new Set<string>();
    const flags = new Set<string>();
    for (const spec of Object.values(INTERIOR_ENCOUNTER_PREWARM)) {
      for (const [flag, on] of Object.entries(spec)) {
        flags.add(flag);
        if (on === true) staged.add(flag);
      }
    }
    expect([...staged].sort()).toEqual([...ENCOUNTER_PREWARM_SETS].sort());
    expect([...flags].sort()).toEqual([...ENCOUNTER_PREWARM_SETS].sort());
  });

  it('warms the Ignivar mechanic visuals in the Crucible arena, without the Varkhul set', () => {
    const spec = INTERIOR_ENCOUNTER_PREWARM.ignivar;
    expect(spec).toEqual({ ignivarVisuals: true });
    expect(encounterPrewarmForInterior('ignivar')).toEqual(spec);
    expect(spec.varkhulVisuals).toBeUndefined();
  });

  it('warms the Nythraxis floor visuals at arena entry, not boot, and warms no encounter NPC', () => {
    const spec = INTERIOR_ENCOUNTER_PREWARM.nythraxis;
    expect(spec).toBeDefined();
    // Aldric is deliberately absent: measured cold (parked in a start zone that
    // never compiled npc_aldric), his 70% spawn linked ZERO programs because
    // the player bodies on screen already carry them. Soul Rend is absent too:
    // the mark draws the spirit veil, which the boot manifest links.
    expect(spec).toEqual({ nythraxisGraveVisuals: true });
    expect(JSON.stringify(spec)).not.toContain('aldric');
    expect(encounterPrewarmForInterior('nythraxis')).toEqual(spec);
    expect(encounterPrewarmForInterior('crypt')).toBeNull();
    expect(encounterPrewarmForInterior('arena')).toBeNull();

    const renderer = readSource('../src/render/renderer.ts');
    const buildStart = renderer.indexOf(
      'private readonly staticInteriors = new StaticInteriorTracker(',
    );
    const buildEnd = renderer.indexOf('\n  );', buildStart);
    expect(buildStart).toBeGreaterThan(-1);
    expect(buildEnd).toBeGreaterThan(buildStart);
    const build = renderer.slice(buildStart, buildEnd);
    expect(build).toContain('encounterPrewarm.startInteriorEncounterPrewarm(interior, this)');
    const kickAt = build.indexOf('encounterPrewarm.startInteriorEncounterPrewarm(interior, this)');
    const kitAt = build.indexOf('this.ensureDungeons().buildInterior(interior, x, z)');
    expect(kickAt).toBeGreaterThan(-1);
    expect(kitAt).toBeGreaterThan(kickAt);

    // The zone prewarm constants moved to src/render/zone_prewarm_groups.ts
    // at the Phase 16 extraction; the encounter-exclusion claim follows them.
    const prewarmGroups = readSource('../src/render/zone_prewarm_groups.ts');
    const mobListStart = prewarmGroups.indexOf('const PREWARM_MOB_TEMPLATE_IDS = [');
    expect(mobListStart).toBeGreaterThan(-1);
    const mobListEnd = prewarmGroups.indexOf('] as const;', mobListStart);
    expect(mobListEnd).toBeGreaterThan(mobListStart);
    const mobList = prewarmGroups.slice(mobListStart, mobListEnd);
    // Positive control: a renamed marker would leave an empty slice that
    // satisfies every not.toContain below without reading a thing.
    expect(mobList).toContain('forest_wolf');
    expect(mobList).not.toContain(NYTHRAXIS_ALDRIC);
    expect(mobList).not.toContain('nythraxis');
    expect(renderer).not.toContain("'entities.nythraxis");
    expect(prewarmGroups).not.toContain("'entities.nythraxis");
  });

  it('builds no encounter NPC rig at all, in the pass or the host contract', () => {
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    expect(pass).not.toContain('NPCS');
    expect(pass).not.toContain("prewarmEntity('npc'");
    expect(pass).not.toContain('prewarmedNpcModels');
    expect(pass).not.toContain('storePooledVisual');
    // The host contract sheds what only that arm needed, so it cannot come
    // back as dead scaffolding.
    const host = readSource('../src/render/interior_encounter_prewarm_host.ts');
    expect(host).not.toContain('prewarmedNpcModels');
    expect(host).not.toContain('storePooledVisual');
    // The zone prewarm still owns NPC models: this only says the ENCOUNTER
    // pass does not duplicate that job.
    const renderer = readSource('../src/render/renderer.ts');
    expect(renderer).toContain('private prewarmedNpcModels = new Set<string>()');
  });

  it('builds no player rig: the Soul Rend mark needs no encounter warm-up', () => {
    // The mark draws the spirit veil, one program family the boot manifest
    // links for every rig, so warming class rigs or live bodies in the crypt
    // would link nothing new; neither the catalog nor the live arm may return.
    // The one character rig the pass builds is Varkhul's (a mob).
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    for (const gone of [
      'setSoulRend',
      "prewarmEntity('player'",
      'queueLiveSoulRendPrewarm',
      'WEAPON_SKINS',
      'ALL_CLASSES',
    ]) {
      expect(pass, gone).not.toContain(gone);
    }
    expect(pass.match(/createCharacterVisual\(/g)).toHaveLength(1);
    expect(pass.match(/prewarmEntity\(/g)).toHaveLength(1);
    expect(pass).toContain("host.prewarmEntity('mob', template.id");
    const spec = readSource('../src/render/interior_encounter_prewarm.ts');
    expect(spec).not.toMatch(/soulRend/);
    const renderer = readSource('../src/render/renderer.ts');
    expect(renderer).not.toContain('SoulRendPrewarm');
    expect(renderer).not.toContain('setEncounterPrewarmInterior');
  });

  it('drains the visual builds across idle slots instead of one attach-frame burst', () => {
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    const runStart = pass.indexOf('async function runInteriorEncounterPrewarm');
    const runEnd = pass.indexOf('function placeHiddenPrewarmGroup');
    expect(runStart).toBeGreaterThan(-1);
    expect(runEnd).toBeGreaterThan(runStart);
    const body = pass.slice(runStart, runEnd);
    expect(body).toContain('await runIdleQueue(units, (unit) => unit(), {');
    expect(body).toContain('cancelled: () => host.shutdownStarted');
    expect(body).toContain('timeoutMs: IDLE_MS');
    const queueAt = body.indexOf('await runIdleQueue(');
    for (const build of [
      'buildVarkhulEncounterPrewarmVisual()',
      'buildIgnivarEncounterPrewarmVisual()',
      'buildNythraxisGravePrewarmVisual()',
    ])
      expect(body.slice(0, queueAt)).toContain(build);
    // The compile only starts once the queue has drained (or shutdown won).
    const compileAt = body.indexOf('await compileEncounterPrewarmGroup(host, group)');
    expect(compileAt).toBeGreaterThan(queueAt);
    expect(body.slice(queueAt, compileAt)).toContain('if (host.shutdownStarted ||');
  });
});

describe('interior encounter prewarm kill switch', () => {
  it('treats encounterPrewarm=0 and =off as disabled, anything else as enabled', () => {
    expect(encounterPrewarmDisabled('')).toBe(false);
    expect(encounterPrewarmDisabled('?perf&gfx=insane')).toBe(false);
    expect(encounterPrewarmDisabled('?encounterPrewarm=1')).toBe(false);
    expect(encounterPrewarmDisabled('?encounterPrewarm=0')).toBe(true);
    expect(encounterPrewarmDisabled('?encounterPrewarm=off')).toBe(true);
    expect(encounterPrewarmDisabled('perf=1&encounterPrewarm=0&gfx=insane')).toBe(true);
  });

  it('returns before recording a started interior when the URL disables prewarm', () => {
    const pass = readSource('../src/render/interior_encounter_prewarm_pass.ts');
    const start = pass.indexOf('export function startInteriorEncounterPrewarm');
    const run = pass.indexOf('async function runInteriorEncounterPrewarm');
    const body = pass.slice(start, run);
    expect(body).toContain('encounterPrewarmDisabled');
    expect(body.indexOf('encounterPrewarmDisabled')).toBeLessThan(body.indexOf('started.add'));
  });
});
