// @vitest-environment happy-dom
// The Smith's Heart's tank buster alert (the team's feedback of 2026-11-25:
// "show tank busters on screen, not only as a debuff"): the sim's table
// (encounters/smith_heart/tank_buster_ids.ts), the marker each fight lays on
// its tank as a buster begins (tank_buster.ts, from the real fights: Hammer's
// Weight, Bellows Blow, Thunder Lash, Tempering Strike, Elemental Strike), the
// pure view (tank_swap_alert_view.ts buildTankBusterAlertView: the tank it is
// aimed at sees the name and the countdown, nobody else), the composer's mount
// in the screen's middle on every hints setting, the aura strips never showing
// the marker, and the sound in the tank's ear.

import { afterEach, describe, expect, it } from 'vitest';
import { BREATH_MARK_ALARM } from '../src/game/smith_heart_breath_audio_core';
import { RUSH_MARK_ALARM } from '../src/game/smith_heart_council_audio_core';
import { FINAL_MARK_SOUNDS } from '../src/game/smith_heart_final_audio_core';
import { HEART_TANK_BUSTER_SOUND } from '../src/game/smith_heart_mark_audio';
import { QUENCH_MARK_ALARM } from '../src/game/smith_heart_quench_audio_core';
import {
  breathScopeForDev,
  councilScopeForDev,
  finalScopeForDev,
  quenchScopeForDev,
} from '../src/sim/encounters/smith_heart';
import { startBlow } from '../src/sim/encounters/smith_heart/breath_blow';
import { BREATH_CASTS } from '../src/sim/encounters/smith_heart/breath_ids';
import { COUNCIL_CASTS } from '../src/sim/encounters/smith_heart/council_ids';
import { startWeight } from '../src/sim/encounters/smith_heart/council_wrath';
import { ELEMENT_TUNING } from '../src/sim/encounters/smith_heart/final_elements_ids';
import { FINAL_PHASE_CASTS } from '../src/sim/encounters/smith_heart/final_phase_ids';
import { stepStrike } from '../src/sim/encounters/smith_heart/final_strike';
import { QUENCH_TUNING } from '../src/sim/encounters/smith_heart/quench_ids';
import { watchStrikeWindup } from '../src/sim/encounters/smith_heart/quench_strike_windup';
import { warnTankBuster } from '../src/sim/encounters/smith_heart/tank_buster';
import {
  HEART_TANK_BUSTERS,
  heartTankBusterByCode,
  TANK_BUSTER_AURA,
} from '../src/sim/encounters/smith_heart/tank_buster_ids';
import type { Entity } from '../src/sim/types';
import { DungeonPrompts, type DungeonPromptsFrame } from '../src/ui/hud/dungeon/dungeon_prompts';
import {
  buildTankBusterAlertView,
  type TankSwapBody,
} from '../src/ui/hud/dungeon/tank_swap_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { breathFight } from './helpers/breath_fight';
import { councilFight } from './helpers/council_fight';
import { finalFight } from './helpers/final_fight';
import { quenchFight } from './helpers/quench_fight';

setLanguage('en');

const mark = (e: Entity) => e.auras.find((a) => a.id === TANK_BUSTER_AURA);
const marked = (players: readonly Entity[]) => players.filter((p) => mark(p) !== undefined);

/** The view as the tank's (or anyone's) HUD builds it from the live sim. */
function viewFor(self: Entity, entities: ReadonlyMap<number, Entity>) {
  return buildTankBusterAlertView({
    self: self as unknown as TankSwapBody,
    entity: (id) => entities.get(id) as unknown as TankSwapBody | undefined,
  });
}

describe('the tank buster table (the sim data)', () => {
  it('names each boss heavy hit once, its bar where it has one', () => {
    expect(HEART_TANK_BUSTERS.map((b) => [b.key, b.code, b.cast])).toEqual([
      ['weight', 1, COUNCIL_CASTS.weight],
      ['blow', 2, BREATH_CASTS.blow],
      ['thunder', 3, BREATH_CASTS.thunder],
      ['tempering', 4, null],
      ['strike', 5, null],
      ['shear', 6, FINAL_PHASE_CASTS.shear],
    ]);
    for (const b of HEART_TANK_BUSTERS) expect(heartTankBusterByCode(b.code)).toBe(b);
    expect(heartTankBusterByCode(0)).toBeNull();
    expect(heartTankBusterByCode(undefined)).toBeNull();
  });
});

describe('each fight warns only its tank as the buster begins', () => {
  it("Hammer's Weight: the bar's tank, for the bar's length; the view ends with the bar", () => {
    const f = councilFight(4);
    f.dev('/dev heart council pull');
    f.tick();
    const s = councilScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    const g = f.bodies().guardian as Entity;
    g.castingAbility = null;
    s.st.bars.guardian = undefined;
    expect(startWeight(s)).toBe(true);
    const tank = f.sim.ctx.entities.get(g.aggroTargetId as number) as Entity;
    expect(marked(f.players)).toEqual([tank]);
    const m = mark(tank);
    expect(m?.value).toBe(1);
    expect(m?.sourceId).toBe(g.id);
    expect(m?.remaining).toBeCloseTo(g.castRemaining, 6);
    const v = viewFor(tank, f.sim.ctx.entities);
    expect(v.visible && v.title).toBe("Hammer's Weight");
    expect(v.visible && v.line).toBe('On you');
    for (const p of f.players)
      if (p !== tank) expect(viewFor(p, f.sim.ctx.entities).visible).toBe(false);
    // The bar cut: the warning goes with it.
    g.castingAbility = null;
    expect(viewFor(tank, f.sim.ctx.entities).visible).toBe(false);
  });

  it('Bellows Blow and Thunder Lash: the tank alone', () => {
    const f = breathFight(4);
    f.dev('/dev heart breath pull');
    f.tick(2);
    const s = breathScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    const b = f.boss();
    b.castingAbility = null;
    s.st.bar = null;
    expect(startBlow(s)).toBe(true);
    const tank = f.sim.ctx.entities.get(b.aggroTargetId as number) as Entity;
    expect(marked(f.players)).toEqual([tank]);
    expect(mark(tank)?.value).toBe(2);
    const v = viewFor(tank, f.sim.ctx.entities);
    expect(v.visible && v.title).toBe('Bellows Blow');
    // The Storm's lash.
    b.castingAbility = null;
    s.st.bar = null;
    s.st.half = 'storm';
    expect(startBlow(s)).toBe(true);
    expect(mark(tank)?.value).toBe(3);
    expect(marked(f.players)).toEqual([tank]);
  });

  it('Tempering Strike: told with her wind-up, until her swing; an avoided swing ends it', () => {
    const f = quenchFight(4);
    f.dev('/dev heart quench pull');
    f.tick(2);
    const s = quenchScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    const b = f.boss();
    const tank = f.sim.ctx.entities.get(b.aggroTargetId as number) as Entity;
    b.castingAbility = null;
    b.autoAttack = true;
    b.swingCleaveCount = QUENCH_TUNING.strikeEvery - 1;
    b.swingTimer = QUENCH_TUNING.strikeWindup;
    s.st.strikeWound = false;
    watchStrikeWindup(s);
    expect(marked(f.players)).toEqual([tank]);
    expect(mark(tank)?.value).toBe(4);
    expect(mark(tank)?.remaining).toBeCloseTo(QUENCH_TUNING.strikeWindup, 6);
    const v = viewFor(tank, f.sim.ctx.entities);
    expect(v.visible && v.title).toBe('Tempering Strike');
    expect(v.visible && v.barLabel).toBe('1.0 sec');
    // She turned to the other tank: not the first tank's warning any more.
    const other = f.players.find((p) => p !== tank) as Entity;
    b.aggroTargetId = other.id;
    expect(viewFor(tank, f.sim.ctx.entities).visible).toBe(false);
    b.aggroTargetId = tank.id;
    // The cued swing went off and was avoided (the count still waits).
    b.swingTimer = 2.5;
    watchStrikeWindup(s);
    expect(mark(tank)).toBeUndefined();
  });

  it('Elemental Strike: told strikeLead seconds out, gone as it lands', () => {
    const f = finalFight(4);
    f.pullIn('heat');
    f.tick(2);
    const s = finalScopeForDev(f.sim.ctx, f.inst);
    if (!s) throw new Error('no scope');
    s.st.bar = null;
    s.st.elements.strikeClock = ELEMENT_TUNING.strikeLead + 0.5;
    for (let i = 0; i < 9; i++) stepStrike(s);
    expect(marked(f.players)).toEqual([]);
    stepStrike(s);
    stepStrike(s);
    const tank = marked(f.players)[0];
    expect(tank).toBeDefined();
    expect(tank.id).toBe(f.boss().aggroTargetId);
    expect(marked(f.players)).toHaveLength(1);
    expect(mark(tank)?.value).toBe(5);
    expect(viewFor(tank, f.sim.ctx.entities).visible).toBe(true);
    let laid = 0;
    for (let i = 0; i < 40 && laid === 0; i++) laid = stepStrike(s);
    expect(laid).toBeGreaterThan(0);
    expect(mark(tank)).toBeUndefined();
  });

  it('never marks a dead body or anything but a player', () => {
    const f = quenchFight(2);
    const p = f.players[0];
    p.dead = true;
    warnTankBuster(p, f.boss(), 'weight', 1.5);
    expect(mark(p)).toBeUndefined();
    warnTankBuster(f.boss(), f.boss(), 'weight', 1.5);
    expect(mark(f.boss())).toBeUndefined();
  });
});

describe('the alert: who sees it, and the sound in the tank ear', () => {
  it('is hidden while dead, with no marker, or once the countdown is spent', () => {
    const self = (auras: TankSwapBody['auras'], dead = false): TankSwapBody => ({
      id: 1,
      dead,
      auras,
    });
    const view = (b: TankSwapBody) =>
      buildTankBusterAlertView({ self: b, entity: () => undefined });
    const live = { id: TANK_BUSTER_AURA, value: 4, remaining: 0.8, duration: 1, sourceId: 9 };
    expect(view(self([live])).visible).toBe(true);
    expect(view(self([live], true)).visible).toBe(false);
    expect(view(self([])).visible).toBe(false);
    expect(view(self([{ ...live, remaining: 0 }])).visible).toBe(false);
    expect(view(self([{ ...live, value: 99 }])).visible).toBe(false);
    const v = view(self([live]));
    expect(v.visible && v.progress).toBeCloseTo(0.8, 6);
    expect(v.visible && v.progressAria).toBe(
      t('hudChrome.tankBuster.timeAria', { name: 'Tempering Strike', seconds: '0.8' }),
    );
  });

  it("every fight with a buster plays the anvil in the tank's ear as the marker lands", () => {
    expect(HEART_TANK_BUSTER_SOUND.key).toBe('ui_aura_anvil_strike');
    for (const table of [RUSH_MARK_ALARM, BREATH_MARK_ALARM, QUENCH_MARK_ALARM, FINAL_MARK_SOUNDS])
      expect(table[TANK_BUSTER_AURA]).toBe(HEART_TANK_BUSTER_SOUND);
  });
});

describe('DungeonPrompts: the tank buster alert mounts in the middle on every hints setting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function rig(auras: DungeonPromptsFrame['player']['auras'], hints: boolean) {
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
    prompts.paint({
      player: { id: 1, pos: { x: 0, z: 0 }, auras },
      world: {
        entities: new Map() as unknown as DungeonPromptsFrame['world']['entities'],
        entityRosterVersion: 1,
        targetEntity: () => {},
      },
      party: null,
      interactKey: 'F',
      touch: false,
      mechanicHints: hints,
    });
    return layer;
  }

  for (const hints of [true, false]) {
    it(`hints ${hints ? 'on' : 'off'}: the name, "On you" and the countdown`, () => {
      const layer = rig(
        [{ id: TANK_BUSTER_AURA, value: 5, remaining: 1.2, duration: 1.5, sourceId: 900 }],
        hints,
      );
      const el = layer.querySelector<HTMLElement>('#heart-tank-buster');
      expect(el).not.toBeNull();
      expect(el?.style.display).toBe('flex');
      expect(el?.classList.contains('is-buster')).toBe(true);
      expect(el?.querySelector('.fa-title')?.textContent).toBe('Elemental Strike');
      expect(el?.querySelector('.fa-line')?.textContent).toBe('On you');
      expect(el?.querySelector('.fa-bar-label')?.textContent).toBe('1.2 sec');
      // Its own panel: the swap chip stays unmounted.
      expect(layer.querySelector('#heart-tank-swap')).toBeNull();
    });
  }

  it('without the marker nothing mounts', () => {
    expect(rig([], true).querySelector('#heart-tank-buster')).toBeNull();
  });
});
