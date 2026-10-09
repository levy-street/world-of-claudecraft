// @vitest-environment happy-dom
// Morthen the Gravecaller's Rite and the Knellwyrm's heroic Burning Knell reach
// the player LOCALIZED and in the right slot: every English name the sim
// splices into the aura bar, the combat log, the meters and an encounter
// object's nameplate resolves through the client matcher (sim_i18n.ts,
// kit_object_name.ts); every new bar reads as its name on the cast bars,
// translated in the non-Latin locales (the M16 rule), as is the candle's own
// name; the use prompt words the relight as a relight; and the Rite's soft
// reminder gives the shared prompt slot to the relight prompt at a candle while
// a strike to leave keeps it (src/ui/hud/dungeon/dungeon_prompts.ts).

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GRAVEWYRM_SANCTUM_MOBS } from '../src/sim/content/gravewyrm_sanctum';
import { MOBS } from '../src/sim/data';
import {
  BOUND_SOUL_WALKER,
  KNELL_HALF_FIRE_TEMPLATE,
  KNELL_HALF_MARK_TEMPLATE,
  KNELLWYRM_KNELL_BREATH,
  KNELLWYRM_KNELL_LAND,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_KNELL_RISE,
  MORTHEN_CANDLE_ID,
  MORTHEN_GRASP_HANDS_TEMPLATE,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_REAP,
  MORTHEN_RELIGHT_CAST,
  MORTHEN_RITE,
  MORTHEN_SHADOW_PULSE,
  MORTHEN_SOUL_TEMPLATE,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
} from '../src/sim/encounters/hollow_crypt';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';
import { castDisplayName, targetCastDisplayName } from '../src/ui/cast_display_name';
import { tEntity } from '../src/ui/entity_i18n';
import { DungeonPrompts, type DungeonPromptsFrame } from '../src/ui/hud/dungeon/dungeon_prompts';
import { kitUseCopy } from '../src/ui/hud/dungeon/kit_use_prompt_view';
import {
  ensureLocaleLoaded,
  type SupportedLanguage,
  setLanguage,
  type TranslationKey,
  t,
} from '../src/ui/i18n';
import { isKitObjectTemplate, kitObjectDisplayName } from '../src/ui/kit_object_name';
import { makeWriterFacet } from '../src/ui/painter_host';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const NON_LATIN: SupportedLanguage[] = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'];

/** Every English name the encounter modules splice (damage sources, auras,
 *  heals, object names): morthen.ts, morthen_candles.ts, morthen_grasp.ts,
 *  morthen_gravecall.ts, knellwyrm_knell.ts. */
const SIM_NAMES = [
  'Shadow Pulse',
  'Reap the Unquiet',
  'Unquiet Ward',
  'Grave Chill',
  'Rite Broken',
  'Shattered Ward',
  "Candle's Price",
  'Name the Dead',
  'Remembrance Candle',
  'Grasp of the Grave',
  'Burning Knell',
  'Relight the Candle',
  BOUND_SOUL_WALKER.name,
  BOUND_SOUL_WALKER.empower.name,
];

/** Every bar the Rite and the heroic flight put up, with its English name. */
const BARS: [string, string][] = [
  [MORTHEN_SHADOW_PULSE, 'Shadow Pulse'],
  [MORTHEN_RITE, 'Rite of the Unquiet'],
  [MORTHEN_REAP, 'Reap the Unquiet'],
  [MORTHEN_RELIGHT_CAST, 'Relight the Candle'],
  [KNELLWYRM_KNELL_RISE, 'Burning Knell'],
  [KNELLWYRM_KNELL_MARK, 'Burning Knell'],
  [KNELLWYRM_KNELL_BREATH, 'Burning Knell'],
  [KNELLWYRM_KNELL_LAND, 'Burning Knell'],
];

describe("Morthen's Rite localizes", () => {
  beforeAll(async () => {
    await Promise.all(NON_LATIN.map((lang) => ensureLocaleLoaded(lang)));
  });
  afterEach(() => setLanguage('en'));

  it('every name the sim splices resolves through the client matcher', () => {
    setLanguage('en');
    expect(BOUND_SOUL_WALKER.name).toBe('Bound Soul');
    expect(BOUND_SOUL_WALKER.empower.name).toBe('Gorged on the Dead');
    for (const n of SIM_NAMES) expect(localizeSimAuraName(n), n).toBe(n);
  });

  it("the Rite's objects name themselves through the kit object matcher", () => {
    setLanguage('en');
    const objects: [string, string][] = [
      [RITE_CANDLE_DARK, 'Remembrance Candle'],
      [RITE_CANDLE_NAMED, 'Remembrance Candle'],
      [RITE_CANDLE_LIT, 'Remembrance Candle'],
      [MORTHEN_GRASP_TEMPLATE, 'Grasp of the Grave'],
      [MORTHEN_GRASP_HANDS_TEMPLATE, 'Grasp of the Grave'],
      [KNELL_HALF_MARK_TEMPLATE, 'Burning Knell'],
      [KNELL_HALF_FIRE_TEMPLATE, 'Burning Knell'],
      [MORTHEN_SOUL_TEMPLATE, BOUND_SOUL_WALKER.name],
    ];
    for (const [id, name] of objects) {
      expect(isKitObjectTemplate(id), id).toBe(true);
      expect(kitObjectDisplayName(id, name), id).toBe(name);
    }
  });

  it('every bar reads as its name, translated in the non-Latin locales', () => {
    for (const [id, name] of BARS) {
      setLanguage('en');
      expect(t(`abilityUi.cast.${id}` as TranslationKey), id).toBe(name);
      expect(targetCastDisplayName(id), id).toBe(name);
      expect(castDisplayName(id), id).toBe(name);
      for (const lang of NON_LATIN) {
        setLanguage(lang);
        const label = targetCastDisplayName(id);
        expect(label, `${lang} ${id}`).not.toBe(name);
        expect(label, `${lang} ${id}`).not.toBe(id);
      }
    }
    // The relight bar is the candle use's own cast id.
    expect(MOBS[MORTHEN_CANDLE_ID]?.trashKit?.usable?.castId).toBe(MORTHEN_RELIGHT_CAST);
  });

  it("the candle's own name, translated in the non-Latin locales", () => {
    setLanguage('en');
    const ref = { kind: 'mob' as const, id: MORTHEN_CANDLE_ID, field: 'name' as const };
    expect(tEntity(ref)).toBe(MOBS[MORTHEN_CANDLE_ID]?.name);
    for (const lang of NON_LATIN) {
      setLanguage(lang);
      expect(tEntity(ref), lang).not.toBe('Remembrance Candle');
    }
  });

  it('the use prompt words a relight as a relight and a topple as a topple', () => {
    const candle = MOBS[MORTHEN_CANDLE_ID]?.trashKit?.usable;
    const brazier = GRAVEWYRM_SANCTUM_MOBS.soul_brazier.trashKit?.usable;
    expect(candle?.effect.kind).toBe('relight');
    expect(brazier?.effect.kind).toBe('topple');
    expect(kitUseCopy(candle).line).toBe('hudChrome.kitUse.relightLine');
    expect(kitUseCopy(candle).using).toBe('hudChrome.kitUse.relightUsingLine');
    expect(kitUseCopy(brazier).line).toBe('hudChrome.kitUse.toppleLine');
    expect(kitUseCopy(brazier).using).toBe('hudChrome.kitUse.usingLine');
    expect(kitUseCopy(null).key).toBe('hudChrome.kitUse.toppleKey');
  });
});

// ---- DungeonPrompts: the soft Rite reminder gives the slot to the relight ----------

function promptsRig() {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const writers = makeWriterFacet(
    new Map(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {},
    () => {},
  );
  const prompts = new DungeonPrompts({ layer: () => layer, writers, onPress: () => {} });
  const candle = createMob(50, MOBS[MORTHEN_CANDLE_ID], 10, { x: 3, y: 0, z: 0 });
  const entities = new Map<number, Entity>([[50, candle]]);
  let version = 1;
  const frame = (): DungeonPromptsFrame => ({
    player: {
      id: 1,
      pos: { x: 0, z: 0 },
      auras: [{ id: MORTHEN_GRAVE_CHILL, value: 1, value2: 3, remaining: 2, duration: 2 }],
    },
    world: {
      entities: entities as unknown as DungeonPromptsFrame['world']['entities'],
      entityRosterVersion: version,
      targetEntity: () => {},
    },
    party: null,
    interactKey: 'F',
    touch: false,
  });
  const bump = () => {
    version++;
  };
  return { layer, prompts, frame, entities, candle, bump };
}

const shown = (layer: HTMLElement, id: string) => {
  const el = layer.querySelector<HTMLElement>(`#${id}`);
  return el !== null && el.style.display !== 'none';
};

describe('DungeonPrompts: the Rite reminder and the relight prompt share the slot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('at a candle the relight prompt shows; away from it the Rite reminder does', () => {
    const r = promptsRig();
    r.prompts.paint(r.frame());
    const use = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    expect(shown(r.layer, 'kit-use-prompt')).toBe(true);
    expect(use?.classList.contains('is-use')).toBe(true);
    expect(shown(r.layer, 'crypt-alert')).toBe(false);
    // The candle catches (its body leaves): the reminder comes back.
    r.entities.delete(50);
    r.bump();
    r.prompts.paint(r.frame());
    expect(shown(r.layer, 'kit-use-prompt')).toBe(false);
    expect(shown(r.layer, 'crypt-alert')).toBe(true);
    expect(r.layer.querySelector('#crypt-alert')?.classList.contains('is-rite')).toBe(true);
    r.prompts.dispose();
  });

  it('a strike to leave keeps the slot over the relight prompt', () => {
    const r = promptsRig();
    const ring = {
      id: 60,
      kind: 'object',
      templateId: MORTHEN_GRASP_TEMPLATE,
      pos: { x: 0, y: 0, z: 0 },
      scale: 4,
      auras: [],
    } as unknown as Entity;
    r.entities.set(60, ring);
    r.prompts.paint(r.frame());
    expect(shown(r.layer, 'crypt-alert')).toBe(true);
    expect(r.layer.querySelector('#crypt-alert')?.classList.contains('is-grasp')).toBe(true);
    expect(shown(r.layer, 'kit-use-prompt')).toBe(false);
    r.prompts.dispose();
  });
});
