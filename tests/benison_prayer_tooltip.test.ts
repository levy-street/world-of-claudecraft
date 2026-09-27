import { describe, expect, it } from 'vitest';
import {
  BENISON_PRAYER_AURA_ID,
  BENISON_WHISPER_AURA_ID,
} from '../src/sim/combat/priest/benison_dawnweave';
import { Sim } from '../src/sim/sim';
import { type Entity, MAX_LEVEL, type SimEvent } from '../src/sim/types';
import { abilityScalingOf } from '../src/ui/ability_damage';
import { abilityEffectText } from '../src/ui/ability_description';
import { formatNumber, t } from '../src/ui/i18n';
import { WORLD_WITHOUT_HUB_YARD } from './helpers/hub_yard';

function makePriest(powerBonus: number, endpoint: 'min' | 'max') {
  const sim = new Sim({
    seed: 8241,
    playerClass: 'priest',
    autoEquip: true,
    world: WORLD_WITHOUT_HUB_YARD,
  });
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec('holy')).toBe(true);
  for (const slot of ['helmet', 'shoulder', 'chest', 'gloves']) {
    const itemId = `benison_dawnweave_${slot}`;
    sim.addItem(itemId, 1);
    sim.equipItem(itemId);
  }
  const basePower = sim.player.healPower;
  sim.ctx.applyAura(sim.player, {
    id: 'test_healing_power',
    name: 'Healing Power',
    kind: 'buff_spellpower',
    value: powerBonus,
    duration: 600,
    remaining: 600,
    sourceId: sim.player.id,
    school: 'holy',
  });
  expect(sim.player.healPower).toBe(basePower + powerBonus);
  const allyId = sim.addPlayer('warrior', 'Prayer Target');
  const ally = sim.entities.get(allyId);
  if (!ally) throw new Error('missing ally');
  ally.pos = { ...sim.player.pos, x: sim.player.pos.x + 3 };
  sim.partyInvite(allyId, sim.player.id);
  sim.partyAccept(allyId);
  // Pin base-healing range endpoints independently of critical-strike rolls.
  sim.rng.range = (min: number, max: number) => (endpoint === 'min' ? min : max);
  sim.rng.next = () => 0.99;
  sim.targetEntity(allyId, sim.player.id);
  return { sim, ally, healPower: basePower + powerBonus };
}

function cast(sim: Sim, ally: Entity, abilityId: string): SimEvent[] {
  const priest = sim.player;
  priest.gcdRemaining = 0;
  priest.resource = priest.maxResource;
  ally.maxHp = 1_000_000;
  ally.hp = 1;
  sim.castAbility(abilityId);
  const events: SimEvent[] = [];
  for (let tick = 0; tick < 100; tick++) {
    events.push(...sim.tick());
    if (!priest.castingAbility) break;
  }
  expect(priest.castingAbility).toBeNull();
  expect(events.filter((event) => event.type === 'error')).toEqual([]);
  return events;
}

describe('Benison Dawnweave combat and displayed healing', () => {
  it.each([0, 350])(
    'matches actual Choirmend and instant Whispered Prayer with %i bonus healing power',
    (powerBonus) => {
      const results: Record<string, number[]> = { prayer_of_healing: [], lesser_heal: [] };
      const previews: Record<string, string[]> = { prayer_of_healing: [], lesser_heal: [] };
      for (const endpoint of ['min', 'max'] as const) {
        const { sim, ally, healPower } = makePriest(powerBonus, endpoint);
        for (const builder of ['lesser_heal', 'heal', 'flash_heal']) cast(sim, ally, builder);
        expect(sim.player.auras.find((aura) => aura.id === BENISON_PRAYER_AURA_ID)?.stacks).toBe(3);
        for (const abilityId of ['prayer_of_healing', 'lesser_heal']) {
          const resolved = sim.resolvedAbility(abilityId);
          if (!resolved) throw new Error(`missing resolved ability ${abilityId}`);
          expect(sim.player.healPower).toBe(healPower);
          previews[abilityId].push(abilityEffectText(resolved, abilityScalingOf(sim.player)));
          const events = cast(sim, ally, abilityId);
          expect(sim.player.healPower).toBe(healPower);
          const heal = events.find(
            (event) =>
              event.type === 'heal2' &&
              event.targetId === ally.id &&
              event.ability === resolved.def.name,
          );
          if (heal?.type !== 'heal2') throw new Error(`missing heal event ${abilityId}`);
          expect(heal.crit).toBe(false);
          results[abilityId].push(heal.amount);
          if (abilityId === 'prayer_of_healing') {
            expect(
              sim.player.auras.find((aura) => aura.id === BENISON_WHISPER_AURA_ID)?.remaining,
            ).toBeGreaterThan(59);
          } else {
            expect(events.some((event) => event.type === 'castStart')).toBe(false);
            expect(sim.player.auras.some((aura) => aura.id === BENISON_WHISPER_AURA_ID)).toBe(
              false,
            );
          }
        }
      }
      for (const abilityId of ['prayer_of_healing', 'lesser_heal']) {
        const [min, max] = results[abilityId];
        const expected = t('abilityUi.tooltip.damageRange', {
          min: formatNumber(min, { maximumFractionDigits: 1 }),
          max: formatNumber(max, { maximumFractionDigits: 1 }),
        });
        expect(previews[abilityId]).toEqual([expected, expected]);
      }
    },
  );
});
