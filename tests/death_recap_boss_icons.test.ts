// @vitest-environment happy-dom
// The death recap shows a raid or dungeon boss's hit with the SAME icon the
// Adventure Journal shows for that ability. A boss mechanic reaches the recap as
// a `damage` event whose `ability` is the sim's display label and whose
// `abilityId` is absent, so before the journal lookup every one of these cards
// fell back to the generic `attack` icon. The event goes through the meter
// ingest exactly as a host hands it over (a JSON round trip, the online wire's
// own encoding), so offline and online read the same card.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/icons', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/ui/icons')>();
  return { ...real, iconDataUrl: (kind: string, id: string) => `icon:${kind}:${id}` };
});

import { BREATH_GUARDIAN, BREATH_NAMES } from '../src/sim/encounters/smith_heart/breath_ids';
import { FINAL_BOSS, FINAL_NAMES } from '../src/sim/encounters/smith_heart/final_ids';
import { FINAL_PHASE_NAMES } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_GUARDIAN, HEAT_NAMES } from '../src/sim/encounters/smith_heart/heat_ids';
import type { SimEvent } from '../src/sim/types';
import { DeathRecapDialog } from '../src/ui/death_recap_dialog';
import { buildDeathRecapCards } from '../src/ui/death_recap_view';
import { MeterData } from '../src/ui/meters';
import type { DeathRecapRecord } from '../src/ui/meters_death_recap';
import type { IWorld } from '../src/world_api';

const PLAYER = 1;
const BOSS = 90;

function worldWith(bossTemplate: string, bossName: string): IWorld {
  const entities = new Map<number, unknown>();
  entities.set(PLAYER, {
    id: PLAYER,
    kind: 'player',
    name: 'Hero',
    templateId: 'warrior',
    hp: 5000,
    maxHp: 5000,
  });
  entities.set(BOSS, {
    id: BOSS,
    kind: 'mob',
    name: bossName,
    templateId: bossTemplate,
    maxHp: 100000,
    hp: 100000,
    dead: false,
    aggroTargetId: PLAYER,
  });
  return {
    entities,
    player: entities.get(PLAYER),
    partyInfo: null,
  } as unknown as IWorld;
}

/** A boss mechanic's hit as the sim emits it: the display label, no abilityId. */
function bossHit(ability: string, amount = 400): SimEvent {
  const ev = {
    type: 'damage',
    sourceId: BOSS,
    targetId: PLAYER,
    amount,
    crit: false,
    school: 'fire',
    ability,
    kind: 'hit',
  };
  // the online wire carries events as JSON (server/event_frame.ts)
  return JSON.parse(JSON.stringify(ev)) as SimEvent;
}

function recapFor(bossTemplate: string, bossName: string, labels: readonly string[]) {
  const world = worldWith(bossTemplate, bossName);
  const m = new MeterData(0);
  labels.forEach((label, i) => {
    m.onEvent(bossHit(label), world, new Set([PLAYER]), 1000 + i * 100);
  });
  const record: DeathRecapRecord = {
    pid: PLAYER,
    playerName: 'Hero',
    deathTime: 1000 + labels.length * 100,
    events: m.deathRecapBuffer.getRecentEvents(PLAYER),
  };
  return record;
}

const CASES: readonly {
  boss: string;
  name: string;
  label: string;
  icon: string;
}[] = [
  { boss: HEAT_GUARDIAN, name: 'Ignazhar', label: HEAT_NAMES.wheel, icon: 'dgn_heart_wheel' },
  { boss: HEAT_GUARDIAN, name: 'Ignazhar', label: HEAT_NAMES.fist, icon: 'dgn_heart_basalt_fist' },
  { boss: HEAT_GUARDIAN, name: 'Ignazhar', label: HEAT_NAMES.swell, icon: 'dgn_heart_basalt_fist' },
  {
    boss: HEAT_GUARDIAN,
    name: 'Ignazhar',
    label: HEAT_NAMES.brand,
    icon: 'dgn_heart_wellspring_brand',
  },
  // the Cinder Grip burn is a DoT: its tick's label is the aura's name
  { boss: HEAT_GUARDIAN, name: 'Ignazhar', label: HEAT_NAMES.grip, icon: 'dgn_heart_cinder_grip' },
  {
    boss: BREATH_GUARDIAN,
    name: 'Aerwyn',
    label: BREATH_NAMES.pinned,
    icon: 'dgn_heart_bellows_wind',
  },
  { boss: FINAL_BOSS, name: 'Ashgrand', label: FINAL_NAMES.burst, icon: 'dgn_heart_overload' },
  { boss: FINAL_BOSS, name: 'Ashgrand', label: FINAL_NAMES.pulse, icon: 'dgn_heart_overload' },
  {
    boss: FINAL_BOSS,
    name: 'Ashgrand',
    label: FINAL_PHASE_NAMES.fury,
    icon: 'dgn_heart_masterless_fury',
  },
  {
    boss: 'korzul_the_gravewyrm',
    name: 'Korzul',
    label: 'Grave Breath',
    icon: 'dgn_sanctum_grave_breath',
  },
];

describe('death recap: boss hits wear their Adventure Journal icon', () => {
  for (const c of CASES) {
    it(`${c.name}'s ${c.label} shows ${c.icon}`, () => {
      const record = recapFor(c.boss, c.name, [c.label]);
      const [card] = buildDeathRecapCards(record);
      expect(card.ability).toBe(c.label);
      expect(card.abilityId).toBeNull();
      expect(card.iconId).toBe(c.icon);
    });
  }

  it('paints the journal icon in the dialog, not the generic attack icon', () => {
    const record = recapFor(HEAT_GUARDIAN, 'Ignazhar', [HEAT_NAMES.wheel, HEAT_NAMES.brand]);
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dialog = new DeathRecapDialog({
      root: () => root,
      getLatestRecap: () => record,
      attachTooltip: vi.fn(),
      hideTooltip: vi.fn(),
    });
    dialog.open();
    const frames = [...root.querySelectorAll<HTMLElement>('.recap-icon-frame')].map((el) =>
      el.style.backgroundImage.replace(/["']/g, ''),
    );
    expect(frames).toEqual([
      'url(icon:ability:dgn_heart_wheel)',
      'url(icon:ability:dgn_heart_wellspring_brand)',
    ]);
    dialog.close();
    root.remove();
  });
});
