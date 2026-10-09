// The Sunken Bastion's boss alert (src/ui/hud/dungeon/bastion_alert_view.ts):
// the pure view over Olen's and Vael's mirrored auras, then driven from a real veil so
// the alert reads exactly what the sim puts on the player and the figures.

import { describe, expect, it, vi } from 'vitest';
import {
  FOG_SHADE_ID,
  OLEN_IN_BRINE,
  OLEN_SENTENCED,
  OSSICK_ID,
  TURNKEY_ID,
  VAEL_BEACON_LIT,
  VAEL_HOME,
  VAEL_HYMN_DROWNING,
  VAEL_ID,
  VAEL_REAP_MARK,
  VAEL_SHADE_HOLLOW,
  VAEL_VEIL_TRANSITION_SECONDS,
} from '../src/sim/encounters/sunken_bastion';
import type { Entity } from '../src/sim/types';
import { BASTION_ALERT_KINDS, buildBastionAlertView } from '../src/ui/hud/dungeon';
import { boss, engage, fight, put, run, tick } from './helpers/bastion_fight';

// A whole veil over many sim ticks: room for a loaded worker.
vi.setConfig({ testTimeout: 60_000 });

const mark = (id: string, remaining = 3, duration = 6) => ({ id, remaining, duration });

describe('the crown alert view', () => {
  it('stays hidden off the crown fight', () => {
    expect(buildBastionAlertView({ auras: [], targetId: null, entity: () => null }).visible).toBe(
      false,
    );
  });

  it('the scythe behind you comes first, its bar the mark time left', () => {
    const v = buildBastionAlertView({
      auras: [mark(VAEL_HYMN_DROWNING, 9, 18), mark(VAEL_REAP_MARK, 1, 2)],
      targetId: null,
      entity: () => null,
    });
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('reaped');
    expect(v.progress).toBeCloseTo(0.5, 5);
    expect(v.title.length).toBeGreaterThan(0);
  });

  it('under the veil it says the rule, then names the target the beam just touched', () => {
    const real = { auras: [mark(VAEL_BEACON_LIT, 1, 1.5)] };
    const shade = { auras: [mark(VAEL_SHADE_HOLLOW, 1, 1.5)] };
    const dark = { auras: [] };
    const bodies = new Map<number, { auras: { id: string }[] }>([
      [1, real],
      [2, shade],
      [3, dark],
    ]);
    const view = (targetId: number | null) =>
      buildBastionAlertView({
        auras: [mark(VAEL_HYMN_DROWNING, 9, 18)],
        targetId,
        entity: (id) => bodies.get(id),
      });
    const kinds = [view(null), view(1), view(2), view(3)].map((v) => (v.visible ? v.kind : null));
    expect(kinds).toEqual(['veil', 'veil-real', 'veil-shade', 'veil']);
    for (const k of kinds) expect(BASTION_ALERT_KINDS).toContain(k);
    const v = view(1);
    if (!v.visible) throw new Error('hidden');
    expect(v.progress).toBeCloseTo(0.5, 5);
  });
});

describe("the alert on Olen's marks", () => {
  it('the Sentence on you comes first, then the brine underfoot, then the veil', () => {
    const view = (auras: { id: string; remaining?: number; duration?: number }[]) =>
      buildBastionAlertView({ auras, targetId: null, entity: () => null });
    const kind = (auras: { id: string; remaining?: number; duration?: number }[]) => {
      const v = view(auras);
      return v.visible ? v.kind : null;
    };
    expect(kind([mark(OLEN_IN_BRINE, 0.3, 0.3), mark(OLEN_SENTENCED, 2, 5)])).toBe('sentenced');
    expect(kind([mark(OLEN_IN_BRINE, 0.3, 0.3), mark(VAEL_HYMN_DROWNING)])).toBe('brine');
    expect(kind([mark(OLEN_SENTENCED, 2.5, 5), mark(VAEL_REAP_MARK)])).toBe('sentenced');
    const v = view([mark(OLEN_SENTENCED, 2.5, 5)]);
    if (!v.visible) throw new Error('hidden');
    expect(v.progress).toBeCloseTo(0.5, 5);
    const b = view([mark(OLEN_IN_BRINE, 0.3, 0.3)]);
    if (!b.visible) throw new Error('hidden');
    expect(b.progress).toBeNull();
  });
});

describe('the crown alert, driven from a real Fog Veil', () => {
  it('a player on the crown sees the rule, and the right word on each figure as the beam passes', () => {
    const f = fight('normal', 2);
    for (const id of [OSSICK_ID, TURNKEY_ID]) f.sim.ctx.handleDeath(boss(f, id), f.tank);
    const vael = boss(f, VAEL_ID);
    put(f, vael, VAEL_HOME.x, VAEL_HOME.z);
    put(f, f.tank, VAEL_HOME.x, VAEL_HOME.z - 3);
    put(f, f.others[0], 8, 218);
    put(f, f.others[1], -16, 196);
    engage(f, vael);
    run(f, 0.5);
    vael.hp = Math.round(vael.maxHp * 0.69);
    run(f, VAEL_VEIL_TRANSITION_SECONDS + 1.1);
    const me = f.others[0];
    const figures = [...f.sim.ctx.entities.values()].filter(
      (e) => (e.templateId === FOG_SHADE_ID || e === vael) && !e.dead,
    );
    expect(figures).toHaveLength(4);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tick(f);
      for (const fig of figures) {
        const v = buildBastionAlertView({
          auras: me.auras,
          targetId: fig.id,
          entity: (id) => f.sim.ctx.entities.get(id) as Entity | undefined,
        });
        if (!v.visible) throw new Error('hidden under the veil');
        seen.add(v.kind);
        // The word always matches the truth.
        if (v.kind === 'veil-real') expect(fig).toBe(vael);
        if (v.kind === 'veil-shade') expect(fig).not.toBe(vael);
      }
    }
    expect(seen).toEqual(new Set(['veil', 'veil-real', 'veil-shade']));
  });
});
