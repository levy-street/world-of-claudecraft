// Dawn Battle Standard (Church Order toy) live-report regressions:
//   1. the Blessing of the Dawn log line, aura event, and re-application fired
//      on EVERY 2 sec regen pulse after the first 10 sec under the standard;
//   2. the tooltip sold "+5% to all stats for 30 min" while the code granted a
//      flat +5 Stamina for 15 min;
//   3. the planted standard never rendered: the object-view visibility gate
//      hid every non-lootable object outside its delve_/rift_/bg_ allowlist.
import { describe, expect, it } from 'vitest';
import { delveInteractableVisible } from '../src/render/delve_interactable_visibility_core';
import { entityViewCandidatePriority } from '../src/render/entity_view_policy_core';
import {
  DAWN_BLESSING_DELAY_SECONDS,
  DAWN_BLESSING_DURATION_SECONDS,
  DAWN_BLESSING_STAT_PCT,
  DAWN_STANDARD_HP_REGEN_PCT,
  DAWN_STANDARD_MANA_SPIRIT_PCT,
  DAWN_STANDARD_RADIUS,
} from '../src/sim/content/faction_rewards';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { localizeSimText } from '../src/ui/sim_i18n';

const TICKS_PER_SECOND = 20;

function plantedSim(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'priest', autoEquip: false });
  sim.addItem('dawn_battle_standard', 1);
  sim.player.pos = { x: -100, y: 0, z: 200 };
  sim.useItem('dawn_battle_standard');
  sim.drainEvents();
  return sim;
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds * TICKS_PER_SECOND; i++) {
    events.push(...sim.tick());
  }
  return events;
}

function blessingLogs(events: SimEvent[]): SimEvent[] {
  return events.filter((e) => e.type === 'log' && e.text.includes('Blessing of the Dawn'));
}

function blessingGains(events: SimEvent[]): SimEvent[] {
  return events.filter(
    (e) => e.type === 'aura' && e.gained && e.abilityId === 'blessing_of_the_dawn',
  );
}

describe('Dawn Battle Standard', () => {
  it('grants Blessing of the Dawn once per stay, not on every regen pulse', () => {
    const sim = plantedSim(4101);
    const events = run(sim, 60);
    expect(blessingLogs(events)).toHaveLength(1);
    expect(blessingGains(events)).toHaveLength(1);
    expect(sim.player.auras.filter((a) => a.id === 'blessing_of_the_dawn')).toHaveLength(1);
  });

  it('grants it again, once, after the player leaves and comes back', () => {
    const sim = plantedSim(4102);
    run(sim, 20);
    const home = { ...sim.player.pos };
    sim.player.pos = { x: home.x + DAWN_STANDARD_RADIUS + 10, y: 0, z: home.z };
    expect(blessingLogs(run(sim, 4))).toHaveLength(0);
    sim.player.pos = home;
    const back = run(sim, 30);
    expect(blessingLogs(back)).toHaveLength(1);
    expect(blessingGains(back)).toHaveLength(1);
  });

  it('waits the full delay before blessing', () => {
    const sim = plantedSim(4103);
    expect(blessingLogs(run(sim, DAWN_BLESSING_DELAY_SECONDS - 2))).toHaveLength(0);
    expect(sim.player.auras.some((a) => a.id === 'blessing_of_the_dawn')).toBe(false);
  });

  it('raises every primary attribute by the advertised percent for 30 min', () => {
    const sim = plantedSim(4104);
    const before = { ...sim.player.stats };
    run(sim, DAWN_BLESSING_DELAY_SECONDS + 2);
    const blessing = sim.player.auras.find((a) => a.id === 'blessing_of_the_dawn');
    expect(blessing?.kind).toBe('buff_stats_pct');
    expect(blessing?.value).toBe(DAWN_BLESSING_STAT_PCT);
    expect(DAWN_BLESSING_STAT_PCT).toBe(5);
    expect(blessing?.duration).toBe(DAWN_BLESSING_DURATION_SECONDS);
    expect(DAWN_BLESSING_DURATION_SECONDS).toBe(30 * 60);
    for (const stat of ['str', 'agi', 'sta', 'int', 'spi'] as const) {
      expect(sim.player.stats[stat], stat).toBe(
        Math.round(before[stat] * (1 + DAWN_BLESSING_STAT_PCT / 100)),
      );
    }
  });

  it('emits a blessing line the client matcher localizes', () => {
    const sim = plantedSim(4105);
    const [line] = blessingLogs(run(sim, DAWN_BLESSING_DELAY_SECONDS + 2));
    expect(line?.type).toBe('log');
    if (line?.type !== 'log') return;
    expect(line.text).toContain(`${DAWN_BLESSING_STAT_PCT}%`);
    expect(line.text).not.toContain('Stamina');
    expect(localizeSimText(line.text)).toBe(line.text);
  });

  it('adds the advertised health and mana on each 2 sec regen pulse', () => {
    const setup = (sim: Sim) => {
      sim.player.hp = 1;
      sim.player.resource = 1;
    };
    const control = new Sim({ seed: 4107, playerClass: 'priest', autoEquip: false });
    control.player.pos = { x: -100, y: 0, z: 200 };
    const planted = plantedSim(4107);
    setup(control);
    setup(planted);
    // 40 ticks = exactly one 2 sec regen pulse, well before the blessing.
    run(control, 2);
    run(planted, 2);
    const { sta, spi } = planted.player.stats;
    const hpBonus = Math.max(1, Math.round((sta * 0.3 + 2) * (DAWN_STANDARD_HP_REGEN_PCT / 100)));
    const manaBonus = Math.max(1, Math.round(spi * (DAWN_STANDARD_MANA_SPIRIT_PCT / 100)));
    expect(planted.player.hp - control.player.hp).toBe(hpBonus);
    expect(planted.player.resource - control.player.resource).toBe(manaBonus);
  });

  it('keeps the tooltip on the live numbers', () => {
    const text = hudChromeStrings.factionRewards.battleStandardUse;
    expect(text).toContain(`regenerate ${DAWN_STANDARD_HP_REGEN_PCT}% more health`);
    expect(text).toContain(`${DAWN_STANDARD_MANA_SPIRIT_PCT}% of their Spirit`);
    expect(text).toContain(`${DAWN_STANDARD_RADIUS} yards`);
    expect(text).toContain(`${DAWN_BLESSING_DELAY_SECONDS} sec`);
    expect(text).toContain(
      `by ${DAWN_BLESSING_STAT_PCT}% for ${DAWN_BLESSING_DURATION_SECONDS / 60} min`,
    );
    expect(text).not.toMatch(/significantly/i);
  });

  it('renders the planted standard even though it is never lootable', () => {
    const sim = plantedSim(4106);
    const standard = [...sim.entities.values()].find(
      (e) => e.templateId === 'dawn_battle_standard',
    );
    if (!standard) throw new Error('standard was not planted');
    expect(standard.lootable).toBe(false);
    expect(delveInteractableVisible(standard.templateId, standard.lootable)).toBe(true);
    // Same priority tier as the battleground flag body it reuses.
    expect(entityViewCandidatePriority(standard, sim.player, 100)).toBe(2);
  });
});
