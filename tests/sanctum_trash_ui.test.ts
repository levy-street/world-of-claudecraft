// @vitest-environment happy-dom
// The client half of the trash engine's Sanctum pass: the cast-bar names
// (src/ui/cast_display_name.ts), the damage/aura/object names the sim emits as
// English (src/ui/sim_i18n.ts), the trash debuff tooltips
// (src/ui/sanctum_aura_effect.ts), the Sanctum alert's trash kinds
// (src/ui/hud/dungeon/sanctum_alert_view.ts), and the G3 use prompt
// (src/ui/hud/dungeon/kit_use_prompt_view.ts) composed by DungeonPrompts,
// whose boundary is pinned against the interact press ladder
// (src/game/nearby_interaction_core.ts) and whose press is the same target +
// interact the online client sends.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { ClientWorld } from '../src/net/online';
import { DUNGEON_MOBS } from '../src/sim/content/dungeons';
import { GRAVEWYRM_SANCTUM_MOBS } from '../src/sim/content/gravewyrm_sanctum';
import { MOBS } from '../src/sim/data';
import {
  KORZUL_AIRBORNE,
  KORZUL_ID,
  SANCTUM_QUENCH_WATER,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { createMob } from '../src/sim/entity';
import {
  TRASH_DEMO_NOVA,
  TRASH_DEMO_NOVA_UNSTOPPABLE,
  TRASH_DEMO_WALKER,
  TRASH_ENGINE_DEMO_KIT,
} from '../src/sim/mob/trash_kit/engine_demo';
import { freezeStackSlow } from '../src/sim/mob/trash_kit/freeze_stacks';
import {
  SANCTUM_BRANDED,
  SANCTUM_BRANDING_IRON,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_CREEPING_RIME,
  SANCTUM_ICED_OVER,
  SANCTUM_RIME_BREATH,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
} from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity, QuestProgress, TrashKitDef } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName, targetCastDisplayName } from '../src/ui/cast_display_name';
import { DungeonPrompts, type DungeonPromptsFrame } from '../src/ui/hud/dungeon/dungeon_prompts';
import {
  buildKitUsePromptView,
  KIT_USE_PROMPT_RADIUS,
  type KitUseBody,
  type KitUsePromptInput,
  KitUseSceneScan,
} from '../src/ui/hud/dungeon/kit_use_prompt_view';
import {
  buildSanctumAlertView,
  EMPTY_SANCTUM_SCENE,
  RIME_FREEZE_STACKS,
  RIME_WARN_STACKS,
  SANCTUM_ALERT_KINDS,
  type SanctumAlertInput,
} from '../src/ui/hud/dungeon/sanctum_alert_view';
import { setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

setLanguage('en');

const BRAZIER = GRAVEWYRM_SANCTUM_MOBS.soul_brazier;
const USE = BRAZIER.trashKit?.usable;
const BRAND = GRAVEWYRM_SANCTUM_MOBS.broodsworn_goadsmith.trashKit?.brand;
const RIME = GRAVEWYRM_SANCTUM_MOBS.rime_whelp.trashKit?.cone?.freezeStack;

/** Every cast id a trash kit puts on a bar (a mob's castingAbility). */
function kitBarIds(kit: TrashKitDef | undefined): string[] {
  if (!kit) return [];
  const out: string[] = [];
  for (const piece of Object.values(kit) as unknown[]) {
    if (!piece || typeof piece !== 'object') continue;
    const p = piece as { castId?: string; unstoppableCastId?: string };
    if (typeof p.castId === 'string') out.push(p.castId);
    if (typeof p.unstoppableCastId === 'string') out.push(p.unstoppableCastId);
  }
  return out;
}

describe('the trash pass cast-bar names', () => {
  it('every new Sanctum and demo bar reads its English name, never the raw id', () => {
    const named: Record<string, string> = {
      [SANCTUM_THAW_THE_HELD]: 'Thaw the Held',
      [SANCTUM_COUNTERWEIGHT_LASH]: 'Counterweight Lash',
      [SANCTUM_BRANDING_IRON]: 'Branding Iron',
      [SANCTUM_RIME_BREATH]: 'Rime Breath',
      [TRASH_DEMO_NOVA]: 'Test Nova',
      [TRASH_DEMO_NOVA_UNSTOPPABLE]: 'Test Nova',
      [TRASH_DEMO_WALKER]: 'Test Orb',
    };
    for (const [id, name] of Object.entries(named)) {
      expect(targetCastDisplayName(id), id).toBe(name);
      expect(castDisplayName(id), id).toBe(name);
    }
  });

  it("the player's own use bar names the use (castDisplayName), not kituse_*", () => {
    expect(USE?.castId).toBe(SANCTUM_TOPPLE_BRAZIER);
    expect(castDisplayName(SANCTUM_TOPPLE_BRAZIER)).toBe('Topple Brazier');
  });

  it('every bar a Sanctum trash kit or the demo kit can raise resolves to a name', () => {
    const ids = new Set<string>([
      ...Object.values(GRAVEWYRM_SANCTUM_MOBS).flatMap((m) => kitBarIds(m.trashKit)),
      ...kitBarIds(DUNGEON_MOBS.sanctum_drakonid?.trashKit),
      ...kitBarIds(TRASH_ENGINE_DEMO_KIT),
    ]);
    // The stoke pulse, the death bursts and the split put up no bar (their ids
    // ride spellfx only); everything else must be named.
    const barless = new Set([
      'sanctum_soulfire_stoke',
      'sanctum_hoarfrost_pop',
      'sanctum_shatter',
      'sanctum_fracture',
    ]);
    for (const id of ids) {
      if (barless.has(id)) continue;
      const key = `abilityUi.cast.${id}` as TranslationKey;
      expect(t(key), id).not.toBe(id);
      expect(targetCastDisplayName(id), id).toBe(t(key));
    }
  });
});

describe('the sim English the trash pass emits localizes through the matcher', () => {
  it('every damage, aura and object name is registered (en reads it back)', () => {
    for (const name of [
      'Thaw the Held',
      'Counterweight Lash',
      'Boiling Meltwater',
      'Branding Iron',
      'Branded',
      'Topple Brazier',
      'Spilled Soulfire',
      'Rime Breath',
      'Creeping Rime',
      'Iced Over',
      'Ice Slab',
      'Fracture',
      'Test Nova',
      'Test Orb',
    ])
      expect(localizeSimAuraName(name), name).toBe(name);
  });

  it('the names match the content records they come from', () => {
    expect(BRAND?.auraName).toBe('Branded');
    expect(RIME?.name).toBe('Creeping Rime');
    expect(RIME?.freezeName).toBe('Iced Over');
    expect(USE?.effect.kind === 'topple' && USE.effect.hazard.name).toBe('Spilled Soulfire');
    expect(DUNGEON_MOBS.sanctum_drakonid?.trashKit?.breathPool?.hazard.name).toBe(
      'Boiling Meltwater',
    );
    expect(GRAVEWYRM_SANCTUM_MOBS.ogre_sledge_hauler.trashKit?.toss?.leavesWall?.name).toBe(
      'Ice Slab',
    );
    expect(TRASH_ENGINE_DEMO_KIT.nova?.name).toBe('Test Nova');
    expect(TRASH_ENGINE_DEMO_KIT.walker?.empower.name).toBe('Test Orb');
  });
});

describe('the trash debuff tooltips', () => {
  it('Branded states the live burn per tick, its interval, its duration and the douse', () => {
    const d = auraEffectDescriptor({
      id: SANCTUM_BRANDED,
      kind: 'dot',
      value: 30,
      tickInterval: 2,
      school: 'fire',
    });
    expect(d).toEqual({
      key: 'hudChrome.auraEffect.sanctum.branded',
      nums: { value: 30, interval: BRAND?.interval, seconds: BRAND?.seconds },
      school: 'fire',
    });
    expect(BRAND).toMatchObject({ perTick: 30, interval: 2, seconds: 12 });
    // A heroic brand reads its own (multiplied) value off the aura.
    const heroic = auraEffectDescriptor({ id: SANCTUM_BRANDED, kind: 'dot', value: 39 });
    expect(heroic?.nums?.value).toBe(39);
    expect(
      t('hudChrome.auraEffect.sanctum.branded', {
        value: 30,
        school: 'Fire',
        interval: 2,
        seconds: 12,
      }),
    ).toBe(
      'Deals 30 Fire damage every 2 sec for 12 sec. Step into a meltwater pool to put it out at once.',
    );
  });

  it('Creeping Rime reads the live slow off the aura and the rule off the whelp', () => {
    if (!RIME) throw new Error('the Rime Whelp has no freeze stack');
    for (const stacks of [1, 2, 4]) {
      const d = auraEffectDescriptor({
        id: SANCTUM_CREEPING_RIME,
        kind: 'slow',
        value: freezeStackSlow(RIME, stacks),
        stacks,
      });
      expect(d?.key).toBe('hudChrome.auraEffect.sanctum.creepingRime');
      expect(d?.nums).toEqual({
        pct: Math.round(RIME.perStack * stacks * 100),
        per: Math.round(RIME.perStack * 100),
        seconds: RIME.seconds,
        max: RIME.maxStacks,
        freeze: RIME.freezeSeconds,
      });
    }
    expect(RIME).toMatchObject({ perStack: 0.08, seconds: 8, maxStacks: 5, freezeSeconds: 2 });
  });

  it('Iced Over says it is a freeze', () => {
    expect(auraEffectDescriptor({ id: SANCTUM_ICED_OVER, kind: 'stun', value: 0 })).toEqual({
      key: 'hudChrome.auraEffect.sanctum.icedOver',
      nums: {},
    });
    expect(t('hudChrome.auraEffect.sanctum.icedOver')).toContain('Creeping Rime');
  });
});

// ---- the Sanctum alert's trash kinds -----------------------------------------

function alertInput(auras: SanctumAlertInput['auras']): SanctumAlertInput {
  return {
    selfId: 1,
    selfPos: { x: 0, z: 0 },
    auras,
    targetId: null,
    entity: () => null,
    scene: EMPTY_SANCTUM_SCENE,
  };
}

describe('the Sanctum alert: the trash debuffs', () => {
  it('lists the two new kinds for the painter', () => {
    expect(SANCTUM_ALERT_KINDS).toContain('branded');
    expect(SANCTUM_ALERT_KINDS).toContain('rime');
  });

  it('Branded: the douse line, with the burn time left as the bar', () => {
    const v = buildSanctumAlertView(
      alertInput([{ id: SANCTUM_BRANDED, remaining: 9, duration: 12 }]),
    );
    expect(v.visible && v.kind).toBe('branded');
    if (!v.visible) return;
    expect(v.title).toBe('Branded!');
    expect(v.line).toContain('meltwater pool');
    expect(v.progress).toBeCloseTo(0.75);
    expect(v.progressAria).toBe('9 seconds left');
  });

  it('Creeping Rime warns only one or two stacks short of the freeze', () => {
    expect(RIME_FREEZE_STACKS).toBe(RIME?.maxStacks);
    expect(RIME_WARN_STACKS).toBe(3);
    const at = (stacks: number) =>
      buildSanctumAlertView(
        alertInput([{ id: SANCTUM_CREEPING_RIME, stacks, remaining: 4, duration: 8 }]),
      );
    expect(at(1).visible).toBe(false);
    expect(at(2).visible).toBe(false);
    for (const stacks of [3, 4]) {
      const v = at(stacks);
      expect(v.visible && v.kind).toBe('rime');
      if (v.visible) {
        expect(v.line).toBe(`Creeping Rime ${stacks}/5: step out of the whelps' breath`);
        expect(v.progress).toBeCloseTo(0.5);
      }
    }
  });

  it('sits below every boss alert, and the brand outranks the rime', () => {
    const both = [
      { id: SANCTUM_CREEPING_RIME, stacks: 4, remaining: 4, duration: 8 },
      { id: SANCTUM_BRANDED, remaining: 9, duration: 12 },
    ];
    const v = buildSanctumAlertView(alertInput(both));
    expect(v.visible && v.kind).toBe('branded');
    const boss = buildSanctumAlertView(alertInput([{ id: SANCTUM_QUENCH_WATER }, ...both]));
    expect(boss.visible && boss.kind).toBe('quench');
    // Korzul in the air outranks them too (a boss state, step 14).
    const flight = buildSanctumAlertView({
      ...alertInput(both),
      scene: {
        ...EMPTY_SANCTUM_SCENE,
        korzul: { id: 12, templateId: KORZUL_ID, auras: [{ id: KORZUL_AIRBORNE }] },
      },
    });
    expect(flight.visible && flight.kind).toBe('flight');
  });
});

// ---- the G3 use prompt ---------------------------------------------------------

function brazierBody(over: Partial<KitUseBody> = {}): KitUseBody {
  return { id: 50, kind: 'mob', templateId: 'soul_brazier', hp: 100, pos: { x: 3, z: 0 }, ...over };
}

function promptInput(
  bodies: KitUseBody[],
  over: Partial<KitUsePromptInput> = {},
): KitUsePromptInput {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  return {
    self: { pos: { x: 0, z: 0 } },
    bodies,
    entity: (id) => byId.get(id) ?? null,
    interactKey: 'F',
    touch: false,
    ...over,
  };
}

describe('the use prompt view', () => {
  it('the Soul Brazier is the usable body, 4 yd reach', () => {
    expect(USE).toMatchObject({ castId: SANCTUM_TOPPLE_BRAZIER, range: 4, channel: 1 });
    expect(MOBS.soul_brazier?.trashKit?.usable).toBe(USE);
  });

  it('in reach on a keyboard: the keycap and the press line, pressable on the body', () => {
    const v = buildKitUsePromptView(promptInput([brazierBody()]));
    expect(v.visible && v.kind).toBe('use');
    if (!v.visible) return;
    expect(v.title).toBe('Soul Brazier');
    expect(v.key).toBe('F');
    expect(v.hint).toBe('Topple the Soul Brazier onto them');
    expect(v.line).toBe('Kick it over onto the pack: the spill burns them');
    expect(v.pressable).toBe(true);
    expect(v.bodyId).toBe(50);
    expect(v.buttonAria).toBe('Topple the Soul Brazier');
  });

  it('touch names the tap and shows no key; an unbound key names the click', () => {
    const touch = buildKitUsePromptView(promptInput([brazierBody()], { touch: true }));
    expect(touch.visible && touch.key).toBe('');
    expect(touch.visible && touch.hint).toBe('Tap here to topple the Soul Brazier onto them');
    expect(touch.visible && touch.pressable).toBe(true);
    const unbound = buildKitUsePromptView(promptInput([brazierBody()], { interactKey: '' }));
    expect(unbound.visible && unbound.hint).toBe('Click here to topple the Soul Brazier onto them');
    expect(unbound.visible && unbound.pressable).toBe(true);
  });

  it('a little out of reach: the step-closer line, no key and no press', () => {
    const v = buildKitUsePromptView(promptInput([brazierBody({ pos: { x: 5, z: 0 } })]));
    expect(v.visible && v.kind).toBe('use-far');
    if (!v.visible) return;
    expect(v.line).toBe('Get within 4 yd to kick it over');
    expect(v.pressable).toBe(false);
    expect(v.bodyId).toBe(-1);
    expect(v.key).toBe('');
  });

  it('hidden past the prompt radius, for a fallen body, and for a dead player', () => {
    const far = brazierBody({ pos: { x: KIT_USE_PROMPT_RADIUS + 0.1, z: 0 } });
    expect(buildKitUsePromptView(promptInput([far])).visible).toBe(false);
    expect(buildKitUsePromptView(promptInput([brazierBody({ dead: true })])).visible).toBe(false);
    expect(buildKitUsePromptView(promptInput([brazierBody({ hp: 0 })])).visible).toBe(false);
    expect(
      buildKitUsePromptView(
        promptInput([brazierBody()], { self: { pos: { x: 0, z: 0 }, dead: true } }),
      ).visible,
    ).toBe(false);
    // A mob with no usable kit is never offered.
    const goadsmith = brazierBody({ templateId: 'broodsworn_goadsmith' });
    expect(buildKitUsePromptView(promptInput([goadsmith])).visible).toBe(false);
  });

  it('the nearest living body wins', () => {
    const near = brazierBody({ id: 51, pos: { x: 0, z: 2 } });
    const v = buildKitUsePromptView(promptInput([brazierBody(), near]));
    expect(v.visible && v.bodyId).toBe(51);
  });

  it("while the player's own use runs: its bar and what breaks it, no press", () => {
    const v = buildKitUsePromptView(
      promptInput([brazierBody()], {
        self: {
          pos: { x: 0, z: 0 },
          castingAbility: SANCTUM_TOPPLE_BRAZIER,
          castTargetId: 50,
          castRemaining: 0.25,
          castTotal: 1,
        },
      }),
    );
    expect(v.visible && v.kind).toBe('using');
    if (!v.visible) return;
    expect(v.title).toBe('Topple Brazier');
    expect(v.line).toBe('Hold still: a hit, a step or a stun breaks it');
    expect(v.progress).toBeCloseTo(0.75);
    expect(v.pressable).toBe(false);
  });

  it('the scene rescans only when the roster changes', () => {
    const scan = new KitUseSceneScan();
    const brazier = brazierBody();
    const other = { id: 7, kind: 'mob', templateId: 'rime_whelp', pos: { x: 0, z: 0 } };
    const entities = new Map<number, KitUseBody>([
      [brazier.id, brazier],
      [other.id, other],
    ]);
    const first = scan.update({ entities, entityRosterVersion: 1 });
    expect(first.map((b) => b.id)).toEqual([50]);
    entities.delete(50);
    expect(scan.update({ entities, entityRosterVersion: 1 })).toBe(first);
    expect(first.length).toBe(1);
    expect(scan.update({ entities, entityRosterVersion: 2 }).length).toBe(0);
  });
});

// ---- the prompt and the press read the same boundary ---------------------------

function pressWorld(brazierX: number) {
  const player = {
    id: 1,
    kind: 'player',
    templateId: 'player',
    name: 'Adventurer',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    auras: [],
  } as unknown as Entity;
  const brazier = createMob(50, BRAZIER, 18, { x: brazierX, y: 0, z: 0 });
  return {
    brazier,
    world: {
      playerId: 1,
      player,
      entities: new Map<number, Entity>([
        [1, player],
        [50, brazier],
      ]),
      questLog: new Map<string, QuestProgress>(),
      farmPatches: [],
    },
  };
}

describe('the use prompt and the interact press agree', () => {
  for (const x of [1, 3.99, 4, 4.01, 5.5]) {
    it(`at ${x} yd the prompt offers the press exactly when the ladder resolves the use`, () => {
      const { world, brazier } = pressWorld(x);
      const candidate = resolveNearbyInteractionCandidate(world);
      const v = buildKitUsePromptView(
        promptInput([{ ...brazier, pos: { x: brazier.pos.x, z: brazier.pos.z } }]),
      );
      const offered = v.visible && v.kind === 'use';
      expect(offered).toBe(candidate?.kind === 'use');
      expect(offered).toBe(x <= (USE?.range ?? 0));
    });
  }

  it('the use outranks a lootable corpse beside it', () => {
    const { world } = pressWorld(2);
    const corpse = {
      ...world.player,
      id: 60,
      kind: 'mob',
      templateId: 'rime_whelp',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    } as unknown as Entity;
    world.entities.set(60, corpse);
    expect(resolveNearbyInteractionCandidate(world)?.kind).toBe('use');
  });
});

// ---- DungeonPrompts: the mount, the press, the shared slot ----------------------

function promptsRig() {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const calls: string[] = [];
  const writers = makeWriterFacet(
    new Map(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {},
    () => {},
  );
  const prompts = new DungeonPrompts({
    layer: () => layer,
    writers,
    onPress: () => calls.push('interact'),
  });
  const brazier = createMob(50, BRAZIER, 18, { x: 3, y: 0, z: 0 });
  const entities = new Map<number, Entity>([[50, brazier]]);
  const frame = (auras: DungeonPromptsFrame['player']['auras'] = []): DungeonPromptsFrame => ({
    player: { id: 1, pos: { x: 0, z: 0 }, auras },
    world: {
      entities: entities as unknown as DungeonPromptsFrame['world']['entities'],
      entityRosterVersion: 1,
      targetEntity: (id) => calls.push(`target:${id}`),
    },
    party: null,
    interactKey: 'F',
    touch: false,
  });
  return { layer, prompts, calls, frame, brazier };
}

describe('DungeonPrompts: the use prompt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts in reach and a press on it targets the body, then interacts', () => {
    const r = promptsRig();
    r.prompts.paint(r.frame());
    const root = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    expect(root).not.toBeNull();
    expect(root?.style.display).toBe('flex');
    expect(root?.classList.contains('is-use')).toBe(true);
    expect(root?.classList.contains('is-pressable')).toBe(true);
    expect(root?.querySelector('.fa-key')?.textContent).toBe('F');
    root?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['target:50', 'interact']);
    r.prompts.dispose();
  });

  it('out of reach the panel takes no press', () => {
    const r = promptsRig();
    r.brazier.pos.x = 5;
    r.prompts.paint(r.frame());
    const root = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    expect(root?.classList.contains('is-use-far')).toBe(true);
    root?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual([]);
    r.prompts.dispose();
  });

  it('yields the shared slot to an encounter alert, and takes no press while hidden', () => {
    const r = promptsRig();
    r.prompts.paint(r.frame([{ id: SANCTUM_BRANDED, remaining: 6, duration: 12 }]));
    expect(r.layer.querySelector<HTMLElement>('#sanctum-alert')?.style.display).toBe('flex');
    const use = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    // Never mounted (or hidden) while the alert holds the slot.
    expect(use === null || use.style.display === 'none').toBe(true);
    // The alert ends: the prompt comes back.
    r.prompts.paint(r.frame());
    expect(r.layer.querySelector<HTMLElement>('#sanctum-alert')?.style.display).toBe('none');
    expect(r.layer.querySelector<HTMLElement>('#kit-use-prompt')?.style.display).toBe('flex');
    r.prompts.dispose();
  });
});

// ---- online: the press is the ordinary target + interact commands ----------------

describe('ClientWorld: a use press sends target then interact', () => {
  it('a living hostile Soul Brazier is targeted and the interact goes out unfiltered', () => {
    const client = Object.create(ClientWorld.prototype) as ClientWorld;
    const sent: Array<Record<string, unknown>> = [];
    const harness = client as unknown as {
      playerId: number;
      inputSeq: number;
      entities: Map<number, Entity>;
      cmd(payload: Record<string, unknown>): void;
    };
    harness.playerId = 1;
    harness.inputSeq = 0;
    const player = createMob(1, MOBS.rime_whelp, 18, { x: 0, y: 0, z: 0 });
    player.kind = 'player';
    const brazier = createMob(50, BRAZIER, 18, { x: 3, y: 0, z: 0 });
    harness.entities = new Map<number, Entity>([
      [1, player],
      [50, brazier],
    ]);
    harness.cmd = vi.fn((payload: Record<string, unknown>) => sent.push(payload));
    client.targetEntity(50);
    client.interact();
    expect(player.targetId).toBe(50);
    expect(sent).toEqual([{ cmd: 'target', id: 50, seq: 1 }, { cmd: 'interact' }]);
  });
});

describe('trash engine objects carry a localized display name', () => {
  it('knows every engine object template and re-localizes its English name', async () => {
    const { isKitObjectTemplate, kitObjectDisplayName } = await import('../src/ui/kit_object_name');
    for (const id of [
      'sanctum_ice_slab',
      'sanctum_boiling_meltwater',
      'sanctum_spilled_soulfire',
      'trash_demo_walker_orb',
    ])
      expect(isKitObjectTemplate(id), id).toBe(true);
    expect(isKitObjectTemplate('dungeon_gate_closed')).toBe(false);
    expect(kitObjectDisplayName('sanctum_ice_slab', 'Ice Slab')).toBe('Ice Slab');
    expect(kitObjectDisplayName('mailbox', 'Mailbox')).toBeNull();
  });
});
