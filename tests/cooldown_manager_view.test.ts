import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';
import type {
  ActionBarAbility,
  ActionBarSlotState,
  ActionBarWorldInput,
} from '../src/ui/hud/action_bar/action_bar_view';
import { makeSlotState } from '../src/ui/hud/action_bar/action_bar_view';
import {
  type CooldownSpellConfig,
  defaultCooldownSpellConfig,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_config';
import {
  type CooldownManagerTrackedSpell,
  cooldownCueFires,
  cooldownSlotReady,
  createCooldownManagerView,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_view';

const CUE = 'ui_aura_hard_bell';

function spell(id: string, patch: Partial<CooldownSpellConfig> = {}, cue: string | null = CUE) {
  const config = { ...defaultCooldownSpellConfig(), ...patch };
  return { id, config, cue } satisfies CooldownManagerTrackedSpell;
}

/** A feral druid at 20 with a full pool: Gorebite (ferocious_bite) is known and affordable. */
function feral(): Sim {
  const sim = new Sim({ seed: 29, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'feral', rows: {} })).toBe(true);
  sim.player.auras.push(catForm(sim));
  sim.player.comboPoints = 5;
  sim.player.resource = sim.player.maxResource;
  return sim;
}

/** The action bar's world snapshot, built from the live Sim exactly as the Hud does. */
function worldOf(sim: Sim): ActionBarWorldInput {
  return {
    player: sim.player,
    target: null,
    inventory: sim.inventory,
    stealthed: false,
    paladinSpec: null,
    fateThreads: 0,
    entities: sim.entities.values(),
    activeAimSlot: null,
  };
}

function oldBlood(sim: Sim, stacks: number): Aura {
  return {
    id: 'old_blood',
    name: 'Old Blood',
    kind: 'old_blood',
    remaining: 30,
    duration: 30,
    value: 0,
    stacks,
    sourceId: sim.player.id,
    school: 'physical',
  } as Aura;
}

function catForm(sim: Sim): Aura {
  return {
    id: 'cat_form',
    name: 'Cat Form',
    kind: 'form_cat',
    remaining: 3600,
    duration: 3600,
    value: 0.71,
    sourceId: sim.player.id,
    school: 'physical',
  } as Aura;
}

function viewOver(sim: Sim) {
  return createCooldownManagerView({
    resolve: (id) => sim.resolvedAbility(id),
    formatCount: (n) => String(n),
  });
}

const OPEN = { soundsAllowed: true, preview: false };

describe('cooldown manager view: the ready rule and the cue edge', () => {
  it('ignores the GCD, needs the spell usable, and counts a stored charge as ready', () => {
    const slot: ActionBarSlotState = { ...makeSlotState(), kind: 'ability', abilityId: 'x' };
    expect(cooldownSlotReady(slot, false)).toBe(true);
    expect(cooldownSlotReady(slot, true)).toBe(false);
    expect(cooldownSlotReady({ ...slot, cooldownRemaining: 3 }, false)).toBe(false);
    expect(cooldownSlotReady({ ...slot, cooldownRemaining: 3, isCharges: true }, false)).toBe(true);
    expect(cooldownSlotReady({ ...slot, usable: false }, false)).toBe(false);
    expect(cooldownSlotReady({ ...slot, kind: 'empty' }, false)).toBe(false);
  });

  it('fires on becoming ready and on transforming while ready, never on first sight or revert', () => {
    expect(cooldownCueFires('ferocious_bite', undefined, 'ferocious_bite')).toBe(false);
    expect(cooldownCueFires('ferocious_bite', null, 'ferocious_bite')).toBe(true);
    expect(cooldownCueFires('ferocious_bite', 'ferocious_bite', 'ferocious_bite')).toBe(false);
    expect(cooldownCueFires('ferocious_bite', 'ferocious_bite', 'redharvest')).toBe(true);
    expect(cooldownCueFires('ferocious_bite', 'redharvest', 'ferocious_bite')).toBe(false);
    expect(cooldownCueFires('ferocious_bite', 'ferocious_bite', null)).toBe(false);
  });
});

describe('cooldown manager view over a live Sim (feral druid)', () => {
  it('follows Gorebite into Redharvest, lights it, and announces the transform', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite')]);
    const first = view.tick(worldOf(sim), OPEN);
    const button = first.buttons[0];
    expect(button).toMatchObject({
      baseId: 'ferocious_bite',
      abilityId: 'ferocious_bite',
      iconKey: 'ability:ferocious_bite',
      ready: true,
      transformed: false,
      visible: true,
    });
    // Already ready on the first frame observed: recorded, not announced.
    expect(first.cues).toEqual([]);

    sim.player.auras.push(oldBlood(sim, 3));
    const armed = view.tick(worldOf(sim), OPEN);
    expect(armed.buttons[0]).toMatchObject({
      abilityId: 'redharvest',
      iconKey: 'ability:redharvest',
      transformed: true,
      proc: true,
    });
    // The transform is the whole point: it lights up AND it chimes.
    expect(armed.cues).toEqual([{ soundId: CUE, volume: 0.7 }]);

    sim.player.auras = sim.player.auras.filter((aura) => aura.kind !== 'old_blood');
    const reverted = view.tick(worldOf(sim), OPEN);
    expect(reverted.buttons[0]).toMatchObject({ abilityId: 'ferocious_bite', transformed: false });
    expect(reverted.cues).toEqual([]);
  });

  it('dims a spell the player cannot afford and chimes once it becomes affordable', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite')]);
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = 0;
    const broke = view.tick(worldOf(sim), OPEN);
    expect(broke.buttons[0]).toMatchObject({ ready: false, unusable: true, glow: false });
    expect(broke.cues).toEqual([]);
    sim.player.resource = sim.player.maxResource;
    const back = view.tick(worldOf(sim), OPEN);
    expect(back.buttons[0]).toMatchObject({ ready: true, unusable: false, glow: true });
    expect(back.cues).toHaveLength(1);
  });

  it('shows the spell cooldown sweep and seconds, without the GCD sweep', () => {
    const sim = feral();
    const withCooldown = sim.known.find(
      (ability) => ability.def.cooldown >= 10 && !ability.def.passive,
    );
    expect(withCooldown).toBeDefined();
    const id = withCooldown?.def.id ?? '';
    const view = viewOver(sim);
    view.setTracked([spell(id)]);
    sim.player.gcdRemaining = 1;
    const idle = view.tick(worldOf(sim), OPEN);
    // Mid-GCD the button is READY (lit) with no sweep: readiness never counts the GCD.
    expect(idle.buttons[0].ready).toBe(true);
    expect(idle.buttons[0].cooldownPercent).toBe(0);
    const total = ABILITIES[id].cooldown;
    sim.player.cooldowns.set(id, total / 2);
    const cooling = view.tick(worldOf(sim), OPEN);
    expect(cooling.buttons[0].ready).toBe(false);
    expect(cooling.buttons[0].cooldownPercent).toBeCloseTo(50, 5);
    expect(cooling.buttons[0].cdText).toBe(String(Math.ceil(total / 2)));
  });

  it('records edges while sound is gated, so lifting the gate replays nothing', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite')]);
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = 0;
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = sim.player.maxResource;
    const muted = view.tick(worldOf(sim), { soundsAllowed: false, preview: false });
    expect(muted.cues).toEqual([]);
    expect(view.tick(worldOf(sim), OPEN).cues).toEqual([]);
  });

  it('does not chime every tracked spell at once on resurrection', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite'), spell('claw')]);
    view.tick(worldOf(sim), OPEN);
    sim.player.dead = true;
    view.tick(worldOf(sim), OPEN);
    sim.player.dead = false;
    expect(view.tick(worldOf(sim), OPEN).cues).toEqual([]);
    // After that first living frame the ordinary edge applies again.
    sim.player.resource = 0;
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = sim.player.maxResource;
    expect(view.tick(worldOf(sim), OPEN).cues).toHaveLength(2);
  });

  it('does not chime the spells a spec swap teaches that are already ready', () => {
    const sim = feral();
    const feralKnown = new Set(sim.known.map((ability) => ability.def.id));
    const probe = feral();
    expect(probe.applyTalents({ spec: 'balance', rows: {} })).toBe(true);
    const taught = probe.known
      .filter((ability) => !ability.def.passive && !feralKnown.has(ability.def.id))
      .map((ability) => ability.def.id);
    expect(taught.length).toBeGreaterThan(0);
    const view = viewOver(sim);
    view.setTracked(taught.map((id) => spell(id)));
    // Tracked while unknown (Other Spells): nothing to announce.
    view.tick(worldOf(sim), OPEN);
    view.tick(worldOf(sim), OPEN);
    expect(sim.applyTalents({ spec: 'balance', rows: {} })).toBe(true);
    sim.player.resource = sim.player.maxResource;
    const swapped = view.tick(worldOf(sim), OPEN);
    expect(swapped.buttons.some((button) => button.ready)).toBe(true);
    expect(swapped.cues).toEqual([]);
    // After that first known frame the ordinary edge applies again.
    const readyCount = swapped.buttons.filter((button) => button.ready).length;
    sim.player.resource = 0;
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = sim.player.maxResource;
    expect(view.tick(worldOf(sim), OPEN).cues.length).toBeGreaterThan(0);
    expect(readyCount).toBeGreaterThan(0);
  });

  it('plays nothing for a silent spell, and dedupes nothing it should not', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite', {}, null)]);
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = 0;
    view.tick(worldOf(sim), OPEN);
    sim.player.resource = sim.player.maxResource;
    expect(view.tick(worldOf(sim), OPEN).cues).toEqual([]);
  });

  it('hides an only-when-ready spell until ready, but the placement preview shows it', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite', { onlyWhenReady: true })]);
    sim.player.resource = 0;
    expect(view.tick(worldOf(sim), OPEN).buttons[0].visible).toBe(false);
    expect(view.tick(worldOf(sim), { soundsAllowed: true, preview: true }).buttons[0].visible).toBe(
      true,
    );
    sim.player.resource = sim.player.maxResource;
    expect(view.tick(worldOf(sim), OPEN).buttons[0].visible).toBe(true);
  });

  it('flags the hotbar glow only while ready and only when asked for', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite', { hotbarGlow: true }), spell('claw')]);
    const lit = view.tick(worldOf(sim), OPEN);
    expect(lit.buttons.map((b) => b.hotbarGlow)).toEqual([true, false]);
    sim.player.resource = 0;
    expect(view.tick(worldOf(sim), OPEN).buttons[0].hotbarGlow).toBe(false);
  });

  it('hides a spell the player does not know rather than inventing a state for it', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('fireball')]);
    const state = view.tick(worldOf(sim), OPEN);
    expect(state.buttons[0]).toMatchObject({ abilityId: null, visible: false, ready: false });
  });

  it('reuses its containers every tick (no per-frame garbage)', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([spell('ferocious_bite'), spell('claw')]);
    const a = view.tick(worldOf(sim), OPEN);
    const buttons = a.buttons;
    const first = a.buttons[0];
    const b = view.tick(worldOf(sim), OPEN);
    expect(b).toBe(a);
    expect(b.buttons).toBe(buttons);
    expect(b.buttons[0]).toBe(first);
  });
});

describe('cooldown manager view: aura entries (engines, procs, buffs)', () => {
  const OLD_BLOOD = { match: 'kind' as const, value: 'old_blood', iconKey: 'aura:old_blood' };

  it('tracks the Old Blood engine: stacks, a stack goal that lights and chimes, and dims when gone', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([
      {
        id: 'kind:old_blood',
        config: { ...defaultCooldownSpellConfig(), alertStacks: 3 },
        cue: CUE,
        aura: OLD_BLOOD,
      },
      spell('claw'),
    ]);
    const empty = view.tick(worldOf(sim), OPEN).buttons[0];
    expect(empty).toMatchObject({
      iconKey: 'aura:old_blood',
      ready: false,
      unusable: true,
      count: '',
    });

    sim.player.auras.push(oldBlood(sim, 2));
    const two = view.tick(worldOf(sim), OPEN);
    expect(two.buttons[0]).toMatchObject({
      ready: false,
      unusable: false,
      count: '2',
      proc: false,
    });
    expect(two.cues).toEqual([]);
    // The spell beside it still reads through the action bar's view.
    expect(two.buttons[1]).toMatchObject({ abilityId: 'claw', ready: true });

    const blood = sim.player.auras.find((aura) => aura.kind === 'old_blood');
    if (blood) blood.stacks = 3;
    const full = view.tick(worldOf(sim), OPEN);
    expect(full.buttons[0]).toMatchObject({
      ready: true,
      proc: true,
      glow: true,
      count: '3',
      cdText: '30',
    });
    expect(full.cues).toEqual([{ soundId: CUE, volume: 0.7 }]);

    sim.player.auras = sim.player.auras.filter((aura) => aura.kind !== 'old_blood');
    expect(view.tick(worldOf(sim), OPEN).buttons[0]).toMatchObject({
      ready: false,
      unusable: true,
    });
  });

  it('with no stack goal, lights and chimes the moment the aura appears', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([
      { id: 'kind:old_blood', config: defaultCooldownSpellConfig(), cue: CUE, aura: OLD_BLOOD },
    ]);
    view.tick(worldOf(sim), OPEN);
    sim.player.auras.push(oldBlood(sim, 1));
    const up = view.tick(worldOf(sim), OPEN);
    expect(up.buttons[0]).toMatchObject({ ready: true, proc: false, count: '' });
    expect(up.cues).toHaveLength(1);
  });

  it('hides an only-while-active aura until it is up, and never lights the hotbar', () => {
    const sim = feral();
    const view = viewOver(sim);
    view.setTracked([
      {
        id: 'kind:old_blood',
        config: { ...defaultCooldownSpellConfig(), onlyWhenReady: true, hotbarGlow: true },
        cue: null,
        aura: OLD_BLOOD,
      },
    ]);
    expect(view.tick(worldOf(sim), OPEN).buttons[0].visible).toBe(false);
    sim.player.auras.push(oldBlood(sim, 1));
    expect(view.tick(worldOf(sim), OPEN).buttons[0]).toMatchObject({
      visible: true,
      hotbarGlow: false,
    });
  });
});

describe('cooldown manager view over a ClientWorld-shaped mirror', () => {
  it('reads the same structural snapshot an online mirror supplies', () => {
    const def = ABILITIES.ferocious_bite;
    const ability: ActionBarAbility = { def, cost: 0 };
    const cooldowns = new Map<string, number>();
    const world = {
      player: {
        id: 1,
        autoAttack: false,
        dead: false,
        resource: 100,
        resourceType: 'energy',
        savedMana: 0,
        cooldowns,
        gcdRemaining: 0,
        potionCdRemaining: 0,
        queuedOnSwing: null,
        pos: { x: 0, y: 0, z: 0 },
        auras: [{ kind: 'form_cat' }],
        comboPoints: 5,
      },
      target: null,
      inventory: [],
      stealthed: false,
      entities: [],
      activeAimSlot: null,
    } as ActionBarWorldInput;
    const view = createCooldownManagerView({
      resolve: (id) => (id === 'ferocious_bite' ? ability : null),
      formatCount: String,
    });
    view.setTracked([spell('ferocious_bite')]);
    expect(view.tick(world, OPEN).buttons[0]).toMatchObject({ ready: true, visible: true });
    world.player.dead = true;
    expect(view.tick(world, OPEN).buttons[0].ready).toBe(false);
  });
});
