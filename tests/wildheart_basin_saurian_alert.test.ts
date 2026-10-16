// The Great Saurian's part of the Wildheart Basin alert (src/ui/hud/dungeon/
// wildheart_saurian_alert_view.ts, called by wildheart_alert_view.ts) and its
// aura tooltips (src/ui/wildheart_aura_effect.ts): the totem rework and the
// heroic drum taught on the shared encounter alert family. The view reads only
// what the sim mirrors (the Saurian's Stomp bar and drum aura, the Sap Totems'
// own bodies and bars), so these drive it with plain literals.

import { describe, expect, it } from 'vitest';
import {
  GREAT_SAURIAN_ID,
  SAP_TOTEM_ID,
  SAURIAN_DRUM_SILENCED,
  SAURIAN_SAP_TETHER,
  SAURIAN_SAPPED,
  SAURIAN_STOMP,
  SAURIAN_WAR_DRUM,
  SAURIAN_TUNING as T,
  ZULGAR_ID,
  ZULGAR_PREY,
  ZULGAR_SUNSTRUCK_EXPOSED,
} from '../src/sim/encounters/wildheart_basin/ids';
import type { AuraKind } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import {
  DUNGEON_PROMPT_ADVISORY,
  dungeonPromptEnabled,
} from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
import {
  WildheartAlertSceneScan,
  type WildheartSceneEntity,
} from '../src/ui/hud/dungeon/wildheart_alert_scene_core';
import {
  buildWildheartAlertView,
  WILDHEART_ALERT_KINDS,
  WILDHEART_SOFT_ALERT_KINDS,
  type WildheartAlertInput,
  type WildheartAlertScene,
} from '../src/ui/hud/dungeon/wildheart_alert_view';
import {
  buildSaurianAlert,
  SAURIAN_ALERT_KINDS,
} from '../src/ui/hud/dungeon/wildheart_saurian_alert_view';
import { setLanguage, t } from '../src/ui/i18n';

setLanguage('en');

const FORD = { x: 800, z: 400 };

const saurian = (over: Partial<WildheartSceneEntity> = {}): WildheartSceneEntity => ({
  id: 10,
  kind: 'mob',
  templateId: GREAT_SAURIAN_ID,
  pos: FORD,
  auras: [],
  castingAbility: null,
  castRemaining: 0,
  castTotal: 0,
  ...over,
});

const totem = (id: number, over: Partial<WildheartSceneEntity> = {}): WildheartSceneEntity => ({
  id,
  kind: 'mob',
  templateId: SAP_TOTEM_ID,
  hp: 80,
  pos: { x: FORD.x + T.totemRange, z: FORD.z },
  castingAbility: SAURIAN_SAP_TETHER,
  castRemaining: 3,
  castTotal: T.totemArm,
  ...over,
});

function scan(entities: WildheartSceneEntity[]): WildheartAlertScene {
  const map = new Map<number, WildheartSceneEntity>();
  for (const e of entities) if (e.id !== undefined) map.set(e.id, e);
  return new WildheartAlertSceneScan().update({ entities: map, entityRosterVersion: 1 });
}

function view(scene: WildheartAlertScene, over: Partial<WildheartAlertInput> = {}) {
  const ents = new Map<number, WildheartSceneEntity>();
  if (scene.saurian?.id !== undefined) ents.set(scene.saurian.id, scene.saurian as never);
  return buildWildheartAlertView({
    auras: [],
    targetId: null,
    entity: (id: number) => ents.get(id) ?? null,
    selfId: 1,
    selfPos: { x: FORD.x + 30, z: FORD.z },
    scene,
    ...over,
  });
}

function kind(scene: WildheartAlertScene, over: Partial<WildheartAlertInput> = {}): string {
  const v = view(scene, over);
  return v.visible ? v.kind : 'hidden';
}

describe("the Saurian's alert", () => {
  it('is part of the Wildheart alert, which is advisory: the hints setting hides it', () => {
    for (const k of SAURIAN_ALERT_KINDS) expect(WILDHEART_ALERT_KINDS).toContain(k);
    for (const k of SAURIAN_ALERT_KINDS) expect(WILDHEART_SOFT_ALERT_KINDS.has(k)).toBe(false);
    expect(DUNGEON_PROMPT_ADVISORY.wildheart).toBe(true);
    expect(dungeonPromptEnabled('wildheart', false)).toBe(false);
  });

  it('says nothing with no Saurian in view, or a dead one', () => {
    expect(kind(scan([]))).toBe('hidden');
    expect(kind(scan([saurian({ dead: true }), totem(20)]))).toBe('hidden');
    expect(buildSaurianAlert({ saurian: null, sapTotems: [] }, FORD, undefined)).toBeNull();
  });

  it('inside the Stomp ring while its bar runs: run out, with the bar', () => {
    const stomping = saurian({ castingAbility: SAURIAN_STOMP, castRemaining: 1.5, castTotal: 2 });
    const scene = scan([stomping]);
    const v = view(scene, { selfPos: { x: FORD.x + T.stompRadius - 1, z: FORD.z } });
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('saurian-stomp');
    expect(v.title).toBe(t('hudChrome.wildheartAlert.saurianStompTitle'));
    expect(v.line).toBe(t('hudChrome.wildheartAlert.saurianStompLine'));
    expect(v.progress).toBeCloseTo(0.75, 6);
    // Outside the ring (a totem's distance): nothing to run from.
    expect(kind(scene, { selfPos: { x: FORD.x + T.totemRange, z: FORD.z } })).toBe('hidden');
  });

  it('a Sap Totem standing: break it, the bar the totem nearest its next mending', () => {
    const scene = scan([
      saurian(),
      totem(20, { castRemaining: 3, castTotal: T.totemArm }),
      totem(21, { castRemaining: 0.5, castTotal: T.totemHealEvery }),
    ]);
    const v = view(scene);
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('sap-totem');
    expect(v.title).toBe(t('hudChrome.wildheartAlert.sapTotemTitle'));
    expect(v.line).toBe(t('hudChrome.wildheartAlert.sapTotemLine', { seconds: '2', count: '2' }));
    expect(v.line).toContain('Totems standing: 2');
    expect(v.progress).toBeCloseTo(0.5 / T.totemHealEvery, 6);
    expect(v.pressable).toBe(false);
    // A fallen totem is not counted.
    const one = scan([saurian(), totem(20), totem(21, { dead: true })]);
    const w = view(one);
    expect(w.visible && w.line).toBe(
      t('hudChrome.wildheartAlert.sapTotemLine', { seconds: '2', count: '1' }),
    );
    expect(kind(scan([saurian(), totem(21, { hp: 0 })]))).toBe('hidden');
  });

  it('heroic: the drum rule shows on a targeted Saurian while it beats and no totem stands', () => {
    const drummed = saurian({ auras: [{ id: SAURIAN_WAR_DRUM }] });
    const scene = scan([drummed]);
    expect(kind(scene)).toBe('hidden');
    const v = view(scene, { targetId: 10 });
    if (!v.visible) throw new Error('hidden');
    expect(v.kind).toBe('drum');
    expect(v.title).toBe(t('hudChrome.wildheartAlert.drumTitle'));
    expect(v.line).toBe(t('hudChrome.wildheartAlert.drumLine', { seconds: '6' }));
    expect(v.line).toContain('Sunbone Sap Totem');
    expect(v.progress).toBeNull();
    // Silenced, it says nothing; with a totem up, the totem is the thing to do.
    const hushed = scan([saurian({ auras: [{ id: SAURIAN_DRUM_SILENCED }] })]);
    expect(kind(hushed, { targetId: 10 })).toBe('hidden');
    expect(kind(scan([drummed, totem(20)]), { targetId: 10 })).toBe('sap-totem');
  });

  it('priority: the ring over a totem; a personal mark over both; over Zulgar readouts', () => {
    const stomping = saurian({ castingAbility: SAURIAN_STOMP, castRemaining: 1, castTotal: 2 });
    const scene = scan([stomping, totem(20)]);
    const near = { selfPos: { x: FORD.x + 3, z: FORD.z } };
    expect(kind(scene, near)).toBe('saurian-stomp');
    expect(kind(scene)).toBe('sap-totem');
    expect(kind(scene, { ...near, auras: [{ id: ZULGAR_PREY, remaining: 5, duration: 20 }] })).toBe(
      'prey',
    );
    const zulgar: WildheartSceneEntity = {
      id: 30,
      kind: 'mob',
      templateId: ZULGAR_ID,
      auras: [{ id: ZULGAR_SUNSTRUCK_EXPOSED, remaining: 2, duration: 3 }],
    };
    expect(kind(scan([saurian(), totem(20), zulgar]))).toBe('sap-totem');
  });

  it('the scene scan keeps the Saurian and its totems off the roster', () => {
    const entities = new Map<number, WildheartSceneEntity>();
    entities.set(10, saurian());
    const s = new WildheartAlertSceneScan();
    const first = s.update({ entities, entityRosterVersion: 1 });
    expect(first.saurian?.id).toBe(10);
    expect(first.sapTotems).toHaveLength(0);
    entities.set(20, totem(20));
    expect(s.update({ entities, entityRosterVersion: 1 }).sapTotems).toHaveLength(0);
    expect(s.update({ entities, entityRosterVersion: 2 }).sapTotems).toHaveLength(1);
  });
});

describe("the Saurian's aura tooltips and bar names", () => {
  const aura = (id: string, kind: AuraKind, value: number, stacks?: number) =>
    auraEffectDescriptor({ id, kind, value, stacks });

  it('fed by its totems: the count, the share of its health and the interval the sim mends on', () => {
    const fed = aura(SAURIAN_SAPPED, 'buff_dr', 0, 3);
    expect(fed?.key).toBe('hudChrome.auraEffect.wildheart.sapped');
    expect(fed?.nums).toEqual({ count: 3, pct: 0.8, seconds: 2 });
    expect(T.totemHealPct * 100).toBeCloseTo(0.8, 9);
    expect(T.totemHealEvery).toBe(2);
    expect(
      t('hudChrome.auraEffect.wildheart.sapped', { count: '3', pct: '0.8', seconds: '2' }),
    ).toBe(
      'Sunbone Sap Totems feeding it: 3. Each heals it for 0.8% of its maximum health every 2 sec. Destroy the totems to stop the healing.',
    );
  });

  it('the drum: how much sooner the Stomp comes, and what silences it', () => {
    const drum = aura(SAURIAN_WAR_DRUM, 'buff_dr', 0);
    expect(drum?.key).toBe('hudChrome.auraEffect.wildheart.howdahDrum');
    // Twice as often: the time between Stomps is halved.
    expect(drum?.nums).toEqual({ pct: 50, seconds: T.drumSilence });
    expect(T.drumStompRate).toBe(2);
    const hush = aura(SAURIAN_DRUM_SILENCED, 'buff_dr', 0);
    expect(hush?.key).toBe('hudChrome.auraEffect.wildheart.drumSilenced');
    expect(t('hudChrome.auraEffect.wildheart.howdahDrum', { pct: '50', seconds: '6' })).toContain(
      'cut by 50%',
    );
  });

  it("a Sap Totem's bar has its name", () => {
    expect(castDisplayName(SAURIAN_SAP_TETHER)).toBe('Ancestral Sap');
  });
});
