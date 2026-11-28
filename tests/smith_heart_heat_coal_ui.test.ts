// The Guardian of the Heat's Live Coal on the client: its aura's tooltip (the
// resolved Heroic numbers and the absorb left, docs/design/tooltip-writing.md),
// its bearer's small chip (coal_alert_view.ts: shown to the bearer only, never
// to anyone else, never hidden by the hints setting), its names localized, and
// the arrow's look over the fuse (heat_coal_fx_core.ts).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import { COAL_SLOTS } from '../src/render/smith_heart_fx/heat_coal_fx';
import {
  COAL_ARROW_SIZE,
  COAL_BURST_SHOW,
  COAL_SELF_SCALE,
  coalFuseSpent,
  coalLook,
} from '../src/render/smith_heart_fx/heat_coal_fx_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_AURAS,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_NAMES,
  HEAT_TUNING as T,
  wellTemplate,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildCoalAlertView } from '../src/ui/hud/dungeon/coal_alert_view';
import { dungeonPromptEnabled } from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

const H = HEAT_DIFFICULTY.heroic;
const r = (v: number, m: number) => Math.max(1, Math.round(v * m));

describe('Live Coal: the tooltip', () => {
  it('says the absorb left, the burn, the leap and the burst in resolved Heroic numbers', () => {
    const d = auraEffectDescriptor({
      id: HEAT_AURAS.coal,
      kind: 'heal_absorb',
      value: 404,
      value2: 604,
    });
    expect(d?.key).toBe('hudChrome.auraEffect.heatGuardian.coal');
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).toContain('404');
    expect(text).toContain(
      `${r(T.coalBurnMin, H.damageMult)} to ${r(T.coalBurnMax, H.damageMult)}`,
    );
    expect(text).toContain(`within ${T.coalLeapR} yd`);
    expect(text).toContain(
      `${r(T.coalLeapMin, H.damageMult)} to ${r(T.coalLeapMax, H.damageMult)}`,
    );
    expect(text).toContain(`in ${T.coalSeconds} sec`);
    expect(text).toContain(
      `${r(T.coalBurstMin, H.punishMult)} to ${r(T.coalBurstMax, H.punishMult)}`,
    );
    expect(text).toContain(`within ${T.coalBurstR} yd`);
    // Mythic rolls Heroic's numbers (the tooltip names one set).
    expect(HEAT_DIFFICULTY.mythic.damageMult).toBe(H.damageMult);
    expect(HEAT_DIFFICULTY.mythic.punishMult).toBe(H.punishMult);
  });

  it('localizes both names', () => {
    expect(localizeSimAuraName(HEAT_NAMES.coal)).toBe(HEAT_NAMES.coal);
    expect(localizeSimAuraName(HEAT_NAMES.coalBurst)).toBe(HEAT_NAMES.coalBurst);
  });
});

describe('Live Coal: the bearer chip', () => {
  const aura = { id: HEAT_AURAS.coal, value: 404, remaining: 6, duration: T.coalSeconds };

  it('shows the bearer the absorb left and the fuse, small', () => {
    const v = buildCoalAlertView({ auras: [aura] });
    expect(v.visible).toBe(true);
    if (!v.visible) return;
    expect(v.title).toBe('Live Coal');
    expect(v.barLabel).toBe('404 to heal');
    expect(v.progress).toBeCloseTo(0.5, 5);
    expect(v.progressAria).toBe('6 seconds until it bursts');
    expect(v.line).toBe('');
    expect(v.hint).toBe('');
    expect(v.pressable).toBe(false);
  });

  it('is hidden without the coal, and while dead', () => {
    expect(buildCoalAlertView({ auras: [] }).visible).toBe(false);
    expect(buildCoalAlertView({ auras: [{ id: HEAT_AURAS.kindling }] }).visible).toBe(false);
    expect(buildCoalAlertView({ auras: [aura], dead: true }).visible).toBe(false);
  });

  it('is an action readout: the hints setting never hides it', () => {
    expect(dungeonPromptEnabled('liveCoal', false)).toBe(true);
    expect(dungeonPromptEnabled('liveCoal', true)).toBe(true);
  });
});

describe('Live Coal: the arrow over the fuse', () => {
  it("its bearer's own is half again as large; it throbs faster toward the burst", () => {
    const other = coalLook(10, T.coalSeconds, false, 0);
    expect(other.size).toBe(COAL_ARROW_SIZE);
    expect(coalLook(10, T.coalSeconds, true, 0).size).toBe(COAL_ARROW_SIZE * COAL_SELF_SCALE);
    for (let c = 0; c < 4; c += 0.05) {
      const g = coalLook(5, T.coalSeconds, false, c).glow;
      expect(g).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(g).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(coalFuseSpent(T.coalSeconds, T.coalSeconds)).toBe(0);
    expect(coalFuseSpent(0, T.coalSeconds)).toBe(1);
    // A missing duration falls back to the tuned fuse.
    expect(coalFuseSpent(T.coalSeconds / 2, 0)).toBeCloseTo(0.5, 9);
  });

  it('shows the burst reach only over the last seconds, filling to the burst', () => {
    expect(coalLook(COAL_BURST_SHOW + 0.1, T.coalSeconds, false, 0).burstShown).toBe(false);
    const start = coalLook(COAL_BURST_SHOW, T.coalSeconds, false, 0);
    expect(start.burstShown).toBe(true);
    expect(start.burstFill).toBeCloseTo(0, 9);
    expect(coalLook(COAL_BURST_SHOW / 2, T.coalSeconds, false, 0).burstFill).toBeCloseTo(0.5, 9);
    expect(coalLook(0, T.coalSeconds, false, 0).burstFill).toBe(1);
    expect(COAL_BURST_SHOW).toBeLessThan(T.coalSeconds);
  });
});

describe('Live Coal: the arrow in the fight painter', () => {
  it('draws over every bearer on the low tier too, hidden until a coal lands, owned by the host', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const ent = (id: number, kind: string, templateId: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: 0,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
        castingAbility: null,
      }) as unknown as Entity;
    const me = ent(1, 'player', 'warrior', -206, 2);
    const other = ent(2, 'player', 'mage', -200, 8);
    const entities = new Map<number, Entity>([
      [1, me],
      [2, other],
      [3, ent(3, 'mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z)],
      [4, ent(4, 'object', wellTemplate('calm'), HEARTH_WELL.x, HEARTH_WELL.z)],
    ]);
    const world = {
      entities,
      player: me,
      playerId: 1,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    // The low tier: the cosmetic layers off (the arrow never reads `detail`).
    (fx as unknown as { detail: boolean }).detail = false;
    const arrows = () => {
      const out: THREE.Mesh[] = [];
      scene.traverse((c) => {
        if (c.name === 'smithHeartHeatCoalArrow') out.push(c as THREE.Mesh);
      });
      return out;
    };
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(arrows()).toHaveLength(COAL_SLOTS);
    expect(arrows().every((a) => !a.visible)).toBe(true);
    for (const a of arrows()) expect(fx.materials).toContain(a.material);
    other.auras.push({
      id: HEAT_AURAS.coal,
      name: HEAT_NAMES.coal,
      kind: 'heal_absorb',
      remaining: 8,
      duration: T.coalSeconds,
      value: 300,
      sourceId: 3,
    } as Entity['auras'][number]);
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(arrows().filter((a) => a.visible)).toHaveLength(1);
    other.auras = [];
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(arrows().filter((a) => a.visible)).toHaveLength(0);
    fx.dispose();
  });

  it('holds still under reduced motion, still glowing', () => {
    const a = coalLook(6, T.coalSeconds, false, 0.3, true);
    const b = coalLook(6, T.coalSeconds, false, 1.7, true);
    expect(a.height).toBe(b.height);
    expect(a.glow).toBe(b.glow);
    expect(a.glow).toBeGreaterThanOrEqual(0.8);
  });

  it('reads a mirrored aura (no duration, no absorb left) without a NaN', () => {
    const v = buildCoalAlertView({ auras: [{ id: HEAT_AURAS.coal, value: 0, remaining: 3 }] });
    expect(v.visible).toBe(true);
    if (!v.visible) return;
    expect(v.progress).toBe(1);
    expect(v.barLabel).toBe('0 to heal');
  });
});
