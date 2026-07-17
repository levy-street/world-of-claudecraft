import { describe, expect, it } from 'vitest';
import { onRangedHit } from '../src/sim/combat/talent_procs';
import { ROW_TREES, validateRowTree } from '../src/sim/content/talent_rows';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const SECOND_BEARING_ID = 'hun_r14_sniper_training';

function hunterSim(
  options: { selected?: boolean; spec?: 'beast_mastery' | 'marksmanship' | 'survival' } = {},
): Sim {
  const sim = new Sim({ seed: 170734, playerClass: 'hunter', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(
    sim.applyTalents({
      spec: options.spec ?? 'marksmanship',
      rows: options.selected === false ? {} : { 14: SECOND_BEARING_ID },
    }),
  ).toBe(true);
  return sim;
}

describe('Coldsight talent: Second Bearing', () => {
  it('keeps the row valid, preserves its siblings, and replaces the flat modifier at the stable id', () => {
    const row = ROW_TREES.hunter.find((candidate) => candidate.level === 14);
    const bearing = row?.options.find((option) => option.id === SECOND_BEARING_ID);

    expect(validateTalentTree(TALENTS.hunter)).toEqual([]);
    expect(validateRowTree(ROW_TREES.hunter)).toEqual([]);
    expect(row?.options.map((option) => option.name)).toEqual([
      'Splitshot',
      'Second Bearing',
      'Viperfletch',
    ]);
    expect(bearing?.effect.ability).toBeUndefined();
    expect(bearing?.effect.proc).toEqual({
      id: 'hun_second_bearing',
      name: 'Second Bearing',
      trigger: { on: 'rangedHit', abilities: ['aimed_shot'] },
      responses: [
        { kind: 'resource', amount: 20 },
        { kind: 'cooldownRefund', ability: 'concussive_shot', seconds: 'reset' },
      ],
    });

    const sim = hunterSim();
    const longDraw = sim.resolvedAbility('aimed_shot');
    const damage = longDraw?.effects.find((effect) => effect.type === 'directDamage');
    const plain = hunterSim({ selected: false }).resolvedAbility('aimed_shot');
    const plainDamage = plain?.effects.find((effect) => effect.type === 'directDamage');
    expect(longDraw?.castTime).toBe(3);
    expect(longDraw?.castTime).toBe(plain?.castTime);
    expect(damage).toEqual(plainDamage);
  });

  it('restores mana and resets Rattling Shot on every landed Long Draw with zero proc RNG', () => {
    const run = (): { resource: number; hasCooldown: boolean; draws: number } => {
      const sim = hunterSim();
      sim.player.resource = 10;
      sim.player.cooldowns.set('concussive_shot', 9);
      let draws = 0;
      sim.ctx.rng.setObserver(() => draws++);

      onRangedHit(sim.ctx, sim.player, 'aimed_shot', sim.player);

      sim.ctx.rng.setObserver(null);
      return {
        resource: sim.player.resource,
        hasCooldown: sim.player.cooldowns.has('concussive_shot'),
        draws,
      };
    };

    expect(run()).toEqual({ resource: 30, hasCooldown: false, draws: 0 });
    expect(run()).toEqual(run());
  });

  it('does not pay out for another shot or when the stable row option is not selected', () => {
    const cases: Array<[Sim, string]> = [
      [hunterSim(), 'concussive_shot'],
      [hunterSim({ selected: false }), 'aimed_shot'],
    ];
    for (const [sim, abilityId] of cases) {
      sim.player.resource = 10;
      sim.player.cooldowns.set('concussive_shot', 9);

      onRangedHit(sim.ctx, sim.player, abilityId, sim.player);

      expect(sim.player.resource).toBe(10);
      expect(sim.player.cooldowns.get('concussive_shot')).toBe(9);
    }
  });

  it('keeps the shared row useful for both sibling specs', () => {
    for (const spec of ['beast_mastery', 'survival'] as const) {
      const sim = hunterSim({ spec });
      sim.player.resource = 10;
      sim.player.cooldowns.set('concussive_shot', 9);

      onRangedHit(sim.ctx, sim.player, 'aimed_shot', sim.player);

      expect(sim.player.resource).toBe(30);
      expect(sim.player.cooldowns.has('concussive_shot')).toBe(false);
    }
  });

  it('caps the mana return and leaves an already-ready Rattling Shot ready', () => {
    const sim = hunterSim();
    sim.player.resource = sim.player.maxResource - 5;

    onRangedHit(sim.ctx, sim.player, 'aimed_shot', sim.player);

    expect(sim.player.resource).toBe(sim.player.maxResource);
    expect(sim.player.cooldowns.has('concussive_shot')).toBe(false);
  });

  it('localizes the option in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Second Bearing', language)).not.toBe('Second Bearing');
    }
  });
});
