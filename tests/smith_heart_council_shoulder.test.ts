// The Hammer Council's Shouldered Stone over a REAL Sim claim: Heroic and Mythic
// only, the Slabwright alone, on while another living member stands within
// reach and off when it is pulled away; the raid hears it, and a wipe takes it.

import { describe, expect, it } from 'vitest';
import { shoulderShellScale } from '../src/render/smith_heart_fx/council_fx_core';
import { HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_AURAS,
  COUNCIL_DIFFICULTY,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

function pulled(tier?: 'heroic' | 'mythic'): CouncilFight {
  const f = councilFight(4, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  return f;
}

function plant(f: CouncilFight, e: Entity, x: number, z: number): void {
  const w = f.world(x, z);
  e.pos.x = w.x;
  e.pos.z = w.z;
  e.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  e.prevPos = { ...e.pos };
  f.sim.ctx.rebucket(e);
}

const shouldered = (e: Entity | null | undefined) =>
  e?.auras.find((a) => a.id === COUNCIL_AURAS.shouldered);

/** Plant the Slabwright at the pit's middle and the other two `away` from it. */
function place(f: CouncilFight, away: number): void {
  const b = f.bodies();
  if (!b.slabwright || !b.guardian || !b.singer) throw new Error('no council');
  plant(f, b.slabwright, HAMMER_PIT.x, HAMMER_PIT.z);
  plant(f, b.guardian, HAMMER_PIT.x + away, HAMMER_PIT.z);
  plant(f, b.singer, HAMMER_PIT.x + away, HAMMER_PIT.z + 2);
}

const CLOSE = T.shoulderReach - 4;
const FAR = T.shoulderReach + 8;

const warns = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'chat' && e.textKey === 'hudChrome.council.warn.shoulder');

describe('Hammer Council: Shouldered Stone', () => {
  it('is Heroic and Mythic only', () => {
    expect(COUNCIL_DIFFICULTY.normal.slabwrightShoulders).toBe(false);
    expect(COUNCIL_DIFFICULTY.heroic.slabwrightShoulders).toBe(true);
    expect(COUNCIL_DIFFICULTY.mythic.slabwrightShoulders).toBe(true);
    const f = pulled();
    place(f, CLOSE);
    f.tick();
    expect(shouldered(f.bodies().slabwright)).toBeUndefined();
  });

  for (const tier of ['heroic', 'mythic'] as const) {
    it(`${tier}: hardens within reach, and only the Slabwright`, () => {
      const f = pulled(tier);
      place(f, CLOSE);
      f.tick();
      const b = f.bodies();
      const aura = shouldered(b.slabwright);
      expect(aura?.kind).toBe('shield_wall');
      expect(aura?.value).toBe(0.8);
      expect(shouldered(b.guardian)).toBeUndefined();
      expect(shouldered(b.singer)).toBeUndefined();
    });
  }

  it('drops when it is pulled out of reach', () => {
    const f = pulled('heroic');
    place(f, CLOSE);
    f.tick();
    expect(shouldered(f.bodies().slabwright)).toBeDefined();
    place(f, FAR);
    f.tick();
    expect(shouldered(f.bodies().slabwright)).toBeUndefined();
  });

  it('one member within reach is enough, a fallen one is not company', () => {
    const f = pulled('heroic');
    place(f, FAR);
    const b = f.bodies();
    if (!b.singer) throw new Error('no singer');
    plant(f, b.singer, HAMMER_PIT.x + CLOSE, HAMMER_PIT.z);
    f.tick();
    expect(shouldered(b.slabwright)).toBeDefined();
    b.singer.hp = 0;
    b.singer.dead = true;
    f.tick();
    expect(shouldered(b.slabwright)).toBeUndefined();
  });

  it('warns the raid, then not again within its gap', () => {
    const f = pulled('heroic');
    place(f, FAR);
    f.tick();
    place(f, CLOSE);
    expect(warns(f.tick()).length).toBeGreaterThan(0);
    place(f, FAR);
    f.tick();
    place(f, CLOSE);
    expect(warns(f.tick())).toEqual([]);
    expect(shouldered(f.bodies().slabwright)).toBeDefined();
  });

  it('a reset takes it', () => {
    const f = pulled('heroic');
    place(f, CLOSE);
    f.tick();
    const b = f.bodies();
    expect(shouldered(b.slabwright)).toBeDefined();
    f.dev('/dev heart council reset');
    expect(shouldered(b.slabwright)).toBeUndefined();
  });

  it('its shell closes from a third of its size to whole in 0.35 s', () => {
    expect(shoulderShellScale(0, 5)).toBeCloseTo(5 * 0.36 * 0.33);
    expect(shoulderShellScale(0.35, 5)).toBeCloseTo(5 * 0.36);
    expect(shoulderShellScale(9, 5)).toBeCloseTo(5 * 0.36);
  });

  it('says what it does in its tooltip and has a localized name', () => {
    const d = auraEffectDescriptor({
      id: COUNCIL_AURAS.shouldered,
      kind: 'shield_wall',
      value: T.shoulderWard,
    });
    const text = t(d?.key as never, d?.nums as never);
    expect(text).toContain('80%');
    expect(text).toContain(`${T.shoulderReach} yd`);
    expect(localizeSimAuraName('Shouldered Stone')).toBe('Shouldered Stone');
    expect(t('hudChrome.council.warn.shoulder' as never)).toContain('Slabwright');
  });
});
