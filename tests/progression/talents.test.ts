import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../../src/sim/content/choice_rows';
import { computeTalentModifiers, emptyAllocation, type TalentAllocation } from '../../src/sim/content/talents';
import {
  applyTalentAllocation,
  deleteTalentLoadout,
  resetTalentRows,
  respecTalents,
  saveTalentLoadout,
  setTalentSpec,
  switchTalentLoadout,
} from '../../src/sim/progression/talents';
import { Sim } from '../../src/sim/sim';
import type { SimContext } from '../../src/sim/sim_context';
import { MAX_LEVEL } from '../../src/sim/types';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

function setup(seed = 5) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as Sim &
    Record<string, any>;
  sim.setPlayerLevel(MAX_LEVEL);
  const ctx = sim.ctx as SimContext;
  const meta = sim.players.get(sim.playerId) as any;
  const e = sim.entities.get(sim.playerId) as any;
  return { ctx, meta, e };
}

const knownIds = (meta: any): string[] => meta.known.map((k: any) => k.def.id).sort();

describe('progression/talents rows-only application', () => {
  it('applies spec plus row picks, bakes modifiers, and row reset keeps the spec', () => {
    const { ctx, meta } = setup();
    const knownBase = knownIds(meta);

    expect(applyTalentAllocation(ctx, alloc({ spec: 'arms', rows: { 14: 'war_r14_mortal_strike' } }))).toBe(true);
    expect(meta.talents).toEqual({ spec: 'arms', rows: { 14: 'war_r14_mortal_strike' } });
    expect(meta.talentMods.spec).toBe('arms');
    expect(meta.talentMods.abilities.mortal_strike.dmgPct).toBeGreaterThan(0);
    expect(knownIds(meta)).not.toEqual(knownBase);

    expect(resetTalentRows(ctx)).toBe(true);
    expect(meta.talents).toEqual({ spec: 'arms', rows: {} });
  });

  it('respec clears rows and retains the chosen specialization', () => {
    const { ctx, meta } = setup();
    expect(applyTalentAllocation(ctx, alloc({ spec: 'prot', rows: { 17: 'war_r17_iron_hide' } }))).toBe(true);
    expect(respecTalents(ctx)).toBe(true);
    expect(meta.talents).toEqual({ spec: 'prot', rows: {} });
  });

  it('setSpec changes only the spec and keeps row choices', () => {
    const { ctx, meta } = setup();
    expect(applyTalentAllocation(ctx, alloc({ spec: 'arms', rows: { 5: 'war_r5_juggernaut' } }))).toBe(true);
    expect(setTalentSpec(ctx, 'fury')).toBe(true);
    expect(meta.talents).toEqual({ spec: 'fury', rows: { 5: 'war_r5_juggernaut' } });
  });
});

describe('progression/talents loadouts', () => {
  it('saveLoadout then switchLoadout restores rows and known abilities', () => {
    const { ctx, meta } = setup();
    expect(
      saveTalentLoadout(
        ctx,
        'Arms rows',
        ['mortal_strike'],
        alloc({ spec: 'arms', rows: { 14: 'war_r14_mortal_strike' } }),
      ),
    ).toBe(0);
    const knownArms = knownIds(meta);

    expect(applyTalentAllocation(ctx, alloc({ spec: 'fury', rows: { 14: 'war_r14_whirlwind' } }))).toBe(true);
    expect(meta.talentMods.spec).toBe('fury');
    expect(knownIds(meta)).not.toEqual(knownArms);

    expect(switchTalentLoadout(ctx, 0)).toBe(true);
    expect(meta.talents).toEqual({ spec: 'arms', rows: { 14: 'war_r14_mortal_strike' } });
    expect(knownIds(meta)).toEqual(knownArms);
  });

  it('deleteLoadout removes a saved build', () => {
    const { ctx, meta } = setup();
    expect(saveTalentLoadout(ctx, 'A', [])).toBe(0);
    expect(meta.loadouts.length).toBe(1);
    expect(deleteTalentLoadout(ctx, 0)).toBe(true);
    expect(meta.loadouts.length).toBe(0);
  });
});

describe('progression/talents Fiesta coupling', () => {
  it('a recompute during an active augment overlay keeps the overlay mods', () => {
    const { ctx, meta, e } = setup();
    respecTalents(ctx);
    const armorNoRows = e.stats.armor;
    const row = CHOICE_ROWS.warrior.rows.find((candidate) => candidate.level === 17);
    const option = row?.options.find((candidate) => candidate.id === 'war_r17_iron_hide');
    expect(option).toBeTruthy();

    meta.fiestaMods = computeTalentModifiers(
      meta.cls,
      alloc({ spec: 'prot', rows: { 17: 'war_r17_iron_hide' } }),
    );
    respecTalents(ctx);
    expect(e.stats.armor).toBeGreaterThan(armorNoRows);

    meta.fiestaMods = null;
    respecTalents(ctx);
    expect(e.stats.armor).toBe(armorNoRows);
  });
});
