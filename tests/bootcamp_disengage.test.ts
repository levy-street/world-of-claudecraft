// @vitest-environment happy-dom
// Graduation teardown: the coach borrows the shared #ui root (the whole HUD)
// and must never remove it. The v0.40 ferry-crossing freeze was exactly this:
// disengage() called root.remove() after the coach refactor re-pointed root
// from its own card to #ui, so riding the ferry off the island deleted the
// entire HUD subtree and every later Hud.update() threw on a null lookup.

import { beforeEach, describe, expect, it } from 'vitest';
import type { CrossHotbarAction } from '../src/game/cross_hotbar';
import { GAMEPAD_CONFIRM, GAMEPAD_NONE, GP } from '../src/game/gamepad_map';
import { Keybinds } from '../src/game/keybinds';
import type { Renderer } from '../src/render/renderer';
import { PROVING_SHORE_NPCS } from '../src/sim/content/proving_shore';
import { CRAB_SUMMON_SITE } from '../src/sim/interactions/crab_summon';
import { Sim } from '../src/sim/sim';
import { BootcampOverlay } from '../src/ui/bootcamp';

describe('BootcampOverlay.disengage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"><div id="petbar"></div></div>';
  });

  it('removes only its own nodes, never the shared #ui root', () => {
    const coach = new BootcampOverlay();
    (coach as unknown as { ensureDom(): void }).ensureDom();
    const ownNodes = document.querySelectorAll('#ui .tut-prompt, #ui .tut-glow').length;
    expect(ownNodes, 'the coach minted its own nodes into #ui').toBeGreaterThan(0);

    (coach as unknown as { disengage(): void }).disengage();

    expect(document.getElementById('ui'), '#ui survives graduation').not.toBeNull();
    expect(document.getElementById('petbar'), 'HUD siblings survive graduation').not.toBeNull();
    expect(
      document.querySelectorAll('#ui .tut-prompt, #ui .tut-glow, #ui .tut-voice').length,
      'the coach cleans up every node it minted',
    ).toBe(0);
  });

  it('mints the coach DOM from a MID-LESSON resume, not only from the arrival caption', () => {
    // The keepsake-ring round regression: a session resuming with the rail
    // station already active never fires the one-shot arrival caption, and
    // captions had become the only ensureDom() caller, so every instruction
    // bubble no-oped for the whole session. Engagement itself must mint.
    const coach = new BootcampOverlay();
    const world = {
      playerId: 1,
      player: { id: 1, pos: { x: -300, y: 0, z: 50 }, dead: false, hp: 100 },
      cfg: { playerClass: 'warrior' },
      questLog: new Map([['q_ps_strike_true', { state: 'active' }]]),
      questState: () => null,
      entities: new Map(),
    } as never;
    const renderer = {
      camYaw: 0,
      worldToScreen: () => ({ x: Number.NaN, y: Number.NaN }),
    } as never;
    const keybinds = { capFor: () => 'F', movementCaps: () => ({}) } as never;

    coach.update(world, renderer, keybinds);

    expect(
      document.querySelectorAll('#ui .tut-prompt').length,
      'engagement minted the instruction bubble without any caption firing',
    ).toBe(1);
  });

  it('re-engages cleanly after a teardown (the return ferry)', () => {
    const coach = new BootcampOverlay();
    const priv = coach as unknown as { ensureDom(): void; disengage(): void };
    priv.ensureDom();
    priv.disengage();
    priv.ensureDom();
    expect(document.querySelectorAll('#ui .tut-prompt').length, 'one prompt, not zero or two').toBe(
      1,
    );
  });
});

describe('BootcampOverlay controller prompt wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    document.body.classList.add('pad-active');
  });

  function paintControllerPrompt(
    sim: Sim,
    focus: { questId: string; state: 'available' | 'active' | 'ready' },
    entries: { button: number; action: string }[],
    crossHotbarEnabled = false,
    options: {
      crossHotbarSets?: CrossHotbarAction[][];
      crossHotbarSet?: number;
      taughtAbilityId?: string | null;
      casterClass?: boolean;
      ringPhase?: 'equip' | 'admire' | null;
    } = {},
  ): void {
    const coach = new BootcampOverlay();
    const internals = coach as unknown as {
      ensureDom(): void;
      updatePrompt(
        world: Sim,
        renderer: Renderer,
        keybinds: Keybinds,
        gamepadBindings: {
          entries(): { button: number; action: string }[];
          kind(): 'xbox';
          crossHotbarEnabled(): boolean;
          crossHotbarSets(): CrossHotbarAction[][];
          crossHotbarSet(): number;
        },
      ): void;
      lastFocus: { questId: string; state: 'available' | 'active' | 'ready' };
      step: null;
      bellPhase: boolean;
      casterClass: boolean;
      taughtAbilityId: string | null;
      deathPhase: 'alive';
      ringPhase: 'equip' | 'admire' | null;
    };
    internals.ensureDom();
    internals.lastFocus = focus;
    internals.step = null;
    internals.bellPhase = false;
    internals.casterClass = options.casterClass ?? false;
    internals.taughtAbilityId = options.taughtAbilityId ?? null;
    internals.deathPhase = 'alive';
    internals.ringPhase = options.ringPhase ?? null;

    internals.updatePrompt(
      sim,
      {
        worldToScreen: () => ({ x: 320, y: 180, behind: false }),
      } as unknown as Renderer,
      new Keybinds(),
      {
        entries: () => entries,
        kind: () => 'xbox',
        crossHotbarEnabled: () => crossHotbarEnabled,
        crossHotbarSets: () => options.crossHotbarSets ?? [],
        crossHotbarSet: () => options.crossHotbarSet ?? 0,
      },
    );
  }

  it('paints the live detected-pad interact glyph over the quest giver', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const tam = PROVING_SHORE_NPCS.warden_tam;
    sim.player.pos.x = tam.pos.x;
    sim.player.pos.z = tam.pos.z;

    paintControllerPrompt(sim, { questId: 'q_ps_the_gauntlet', state: 'available' }, [
      { button: GP.A, action: GAMEPAD_CONFIRM },
    ]);

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('A');
    expect(document.querySelector<HTMLElement>('.tut-prompt')?.style.display).toBe('flex');
  });

  it('paints the bare d-pad target control over an unselected training effigy', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const effigy = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'training_effigy',
    );
    expect(effigy).toBeDefined();
    if (!effigy) return;
    sim.player.pos.x = effigy.pos.x;
    sim.player.pos.z = effigy.pos.z;
    sim.player.targetId = null;

    paintControllerPrompt(sim, { questId: 'q_ps_strike_true', state: 'active' }, [
      { button: GP.DPAD_RIGHT, action: GAMEPAD_NONE },
    ]);

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('D-pad →');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe('Select');
  });

  it('paints a swallowed d-pad slot as targeting while the cross hotbar is enabled', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const effigy = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'training_effigy',
    );
    expect(effigy).toBeDefined();
    if (!effigy) return;
    sim.player.pos.x = effigy.pos.x;
    sim.player.pos.z = effigy.pos.z;
    sim.player.targetId = null;

    paintControllerPrompt(
      sim,
      { questId: 'q_ps_strike_true', state: 'active' },
      [
        { button: GP.DPAD_RIGHT, action: 'slot0' },
        { button: GP.DPAD_LEFT, action: 'slot1' },
      ],
      true,
    );

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('D-pad →');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe('Select');
  });

  it('names the live Attack chord after the training effigy is selected', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const effigy = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'training_effigy',
    );
    expect(effigy).toBeDefined();
    if (!effigy) return;
    sim.player.pos.x = effigy.pos.x;
    sim.player.pos.z = effigy.pos.z;
    sim.player.targetId = effigy.id;
    const primary = Array.from({ length: 16 }, () => null as CrossHotbarAction);
    primary[2] = { type: 'ability', id: 'attack' };

    paintControllerPrompt(
      sim,
      { questId: 'q_ps_strike_true', state: 'active' },
      [{ button: GP.RB, action: 'cycleHotbarSet' }],
      true,
      { crossHotbarSets: [primary] },
    );

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('LT + D-pad →');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe('Attack');
  });

  it('names the live taught-ability chord in the second effigy drill', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const effigy = [...sim.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'training_effigy',
    );
    expect(effigy).toBeDefined();
    if (!effigy) return;
    sim.player.pos.x = effigy.pos.x;
    sim.player.pos.z = effigy.pos.z;
    sim.player.targetId = effigy.id;
    const primary = Array.from({ length: 16 }, () => null as CrossHotbarAction);
    primary[3] = { type: 'ability', id: 'heroic_strike' };

    paintControllerPrompt(sim, { questId: 'q_ps_hone_the_edge', state: 'active' }, [], true, {
      crossHotbarSets: [primary],
      taughtAbilityId: 'heroic_strike',
    });

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('LT + D-pad ↓');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe('Use ability');
  });

  it('keeps the turn-in prompt on Drillmaster Rook when Strike True is ready', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    const rook = PROVING_SHORE_NPCS.drillmaster_rook;
    sim.player.pos.x = rook.pos.x;
    sim.player.pos.z = rook.pos.z;

    paintControllerPrompt(sim, { questId: 'q_ps_strike_true', state: 'ready' }, [
      { button: GP.A, action: GAMEPAD_CONFIRM },
    ]);

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('A');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe(
      'Turn in quest',
    );
  });

  it('derives the ready Rook prompt from the live quest rail', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    sim.questsDone.add('q_ps_the_gauntlet');
    sim.questLog.set('q_ps_strike_true', {
      questId: 'q_ps_strike_true',
      state: 'ready',
      counts: [1],
    });
    const rook = PROVING_SHORE_NPCS.drillmaster_rook;
    sim.player.pos.x = rook.pos.x;
    sim.player.pos.z = rook.pos.z;
    const coach = new BootcampOverlay();

    coach.update(
      sim,
      {
        camYaw: 0,
        worldToScreen: () => ({ x: 320, y: 180, behind: false }),
      } as unknown as Renderer,
      new Keybinds(),
      {
        entries: () => [{ button: GP.A, action: GAMEPAD_CONFIRM }],
        kind: () => 'xbox',
      },
    );

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('A');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe(
      'Turn in quest',
    );
  });

  it('names the default inventory button at the Mister Crabs summon site', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    sim.player.pos.x = CRAB_SUMMON_SITE.x;
    sim.player.pos.z = CRAB_SUMMON_SITE.z;

    paintControllerPrompt(sim, { questId: 'q_ps_mother_of_pearl', state: 'active' }, [
      { button: GP.BACK, action: 'bags' },
    ]);

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('View');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe('Summon');
  });

  it('uses the same inventory button for centered bag lessons', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });

    paintControllerPrompt(
      sim,
      { questId: 'q_ps_mother_of_pearl', state: 'ready' },
      [{ button: GP.BACK, action: 'bags' }],
      false,
      { ringPhase: 'equip' },
    );

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('View');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe(
      'Open your bags',
    );
  });

  it('keeps the pouch lesson centered on bags until the pouch is equipped', () => {
    const sim = new Sim({ seed: 4120, playerClass: 'warrior', autoEquip: true });
    sim.addItem('linen_pouch', 1);

    paintControllerPrompt(sim, { questId: 'q_ps_pouch_and_purse', state: 'ready' }, [
      { button: GP.BACK, action: 'bags' },
      { button: GP.A, action: GAMEPAD_CONFIRM },
    ]);

    expect(document.querySelector('.tut-prompt .tut-keycap')?.textContent).toBe('View');
    expect(document.querySelector('.tut-prompt .tut-prompt-verb')?.textContent).toBe(
      'Open your bags',
    );
    expect(document.querySelector('.tut-prompt')?.classList.contains('tut-prompt-center')).toBe(
      true,
    );
  });
});
