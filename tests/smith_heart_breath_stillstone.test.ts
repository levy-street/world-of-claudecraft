// The Stillstone's use (the Islands of the Wind, encounters/smith_heart/
// breath_isles.ts), Jose's playtest of 2026-11-18:
//   - "it lets me light the crystal many times": a stilled stone is spent,
//     no press or click channels it again (the sim refuses, and a second
//     channel already running is cut the moment the first one lands);
//   - "I get Morthen's 'light the candle' message": the stone shows NO use
//     prompt at all (his call: the channel's own cast bar and the beam from
//     the stone say it), and a click on the crystal in reach starts the
//     channel by itself.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  handlePickedEntity,
  hoverCursorKind,
  type PickInteractionHud,
  type PickInteractionWorld,
} from '../src/game/interactions';
import { isUseOnlyBody, takesNoClick } from '../src/render/world_direct_pick';
import { MOBS } from '../src/sim/data';
import {
  cornicePads,
  isleAt,
  isleSpots,
} from '../src/sim/encounters/smith_heart/breath_isle_geometry';
import {
  closingTemplate,
  ISLE_CASTS,
  ISLE_MOBS,
  ISLE_TUNING as IT,
  padTemplate,
} from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { KIT_USE_SPENT_AURA, kitUsableNow } from '../src/sim/mob/trash_kit/encounter_use';
import { DT, type Entity } from '../src/sim/types';
import {
  buildKitUsePromptView,
  KIT_USE_PROMPT_RADIUS,
} from '../src/ui/hud/dungeon/kit_use_prompt_view';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);

function pulled(): BreathFight {
  const f = breathFight(6, 23);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.wind.remaining = 9999;
  st.inhaleTimer = 9999;
  st.circleTimer = 9999;
  st.skyTimer = 9999;
  st.blowTimer = 9999;
  st.heartTimer = 9999;
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  b.hp = Math.floor(b.maxHp * IT.at) - 5;
  for (let i = 0; i < ticks(2) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
  expect(f.state()?.isles.stage).toBe('nova');
  return f;
}

function killIsle(f: BreathFight, isle: number): void {
  for (const a of f.state()?.isles.adds ?? []) {
    if (a.isle !== isle) continue;
    const e = f.sim.ctx.entities.get(a.id);
    if (e && !e.dead)
      f.sim.ctx.dealDamage(f.boss(), e, e.hp * 20 + 1, false, 'nature', 'Test', 'hit', true); // through a ward
  }
  f.tick(2);
}

function ride(f: BreathFight, p: Entity, from: number, to: number): void {
  const at = from < 0 ? cornicePads()[isleSpots()[to].side] : isleSpots()[from].pad;
  if (!at) throw new Error('no pad');
  f.tick(ticks(IT.rideGrace + 0.1));
  f.put(p, at.x, at.z);
  f.tick(ticks(IT.rideSeconds + 0.6));
  expect(isleAt(f.local(p).x, f.local(p).z)).toBe(to);
}

/** The east chain cleared by `p` (and `q` riding along): its stone awake. */
function eastStone(f: BreathFight, p: Entity, q?: Entity): Entity {
  ride(f, p, -1, 0);
  if (q) ride(f, q, -1, 0);
  killIsle(f, 0);
  ride(f, p, 0, 1);
  if (q) ride(f, q, 0, 1);
  killIsle(f, 1);
  killIsle(f, 1);
  ride(f, p, 1, 2);
  if (q) ride(f, q, 1, 2);
  killIsle(f, 2);
  const id = f.state()?.isles.isles[2].stoneId ?? null;
  const stone = id !== null ? f.sim.ctx.entities.get(id) : undefined;
  if (!stone) throw new Error('no stone');
  expect(stone.templateId).toBe(ISLE_MOBS.stillstone);
  return stone;
}

function atStone(f: BreathFight, p: Entity, dx: number): void {
  const sp = isleSpots()[2].stone;
  if (!sp) throw new Error('no stone spot');
  f.put(p, sp.x + dx, sp.z);
}

describe('a stilled Stillstone is spent', () => {
  it('refuses a second channel once stilled (the press and the bar both)', () => {
    const f = pulled();
    const [, a] = f.players;
    const stone = eastStone(f, a);
    atStone(f, a, 1.5);
    a.targetId = stone.id;
    f.sim.interact(a.id);
    expect(a.castingAbility).toBe(ISLE_CASTS.still);
    f.tick(ticks(5.3));
    expect(f.state()?.isles.isles[2].stilled).toBe(true);
    // Spent: no longer usable, on either host (the marker rides the wire).
    expect(stone.auras.some((x) => x.id === KIT_USE_SPENT_AURA)).toBe(true);
    expect(kitUsableNow(stone)).toBe(false);
    expect(isUseOnlyBody(stone)).toBe(false);
    // A second press starts nothing.
    a.targetId = stone.id;
    f.sim.interact(a.id);
    expect(a.castingAbility).toBeNull();
    f.tick(ticks(6));
    expect(a.castingAbility).toBeNull();
  });

  it('cuts a second channel already running when the first one lands', () => {
    const f = pulled();
    const [, a, b] = f.players;
    const stone = eastStone(f, a, b);
    atStone(f, a, 1.5);
    atStone(f, b, -1.5);
    a.targetId = stone.id;
    f.sim.interact(a.id);
    f.tick(ticks(1));
    b.targetId = stone.id;
    f.sim.interact(b.id);
    expect(b.castingAbility).toBe(ISLE_CASTS.still);
    f.tick(ticks(4.4));
    expect(f.state()?.isles.isles[2].stilled).toBe(true);
    f.tick(2);
    expect(b.castingAbility).toBeNull();
  });
});

describe('the Stillstone shows no prompt; a click channels it', () => {
  it('its use carries no prompt, and the prompt view stays hidden by it', () => {
    const use = MOBS[ISLE_MOBS.stillstone]?.trashKit?.usable;
    expect(use?.promptless).toBe(true);
    // No other usable body is promptless (the candle, the brazier, the spear keep theirs).
    for (const [id, tpl] of Object.entries(MOBS))
      if (id !== ISLE_MOBS.stillstone) expect(tpl.trashKit?.usable?.promptless, id).toBeFalsy();
    const body = { id: 9, kind: 'mob', templateId: ISLE_MOBS.stillstone, pos: { x: 0, z: 0 } };
    for (const d of [1, (use?.range ?? 5) + 0.5, KIT_USE_PROMPT_RADIUS - 0.1]) {
      const view = buildKitUsePromptView({
        self: { pos: { x: d, z: 0 } },
        bodies: [body],
        entity: () => body,
        interactKey: 'F',
        touch: false,
      });
      expect(view.visible, `at ${d}`).toBe(false);
    }
    // Nor while the channel runs (the cast bar says it).
    const using = buildKitUsePromptView({
      self: {
        pos: { x: 1, z: 0 },
        castingAbility: ISLE_CASTS.still,
        castTargetId: 9,
        castRemaining: 3,
        castTotal: 5,
      },
      bodies: [body],
      entity: () => body,
      interactKey: 'F',
      touch: false,
    });
    expect(using.visible).toBe(false);
  });

  it('a click on the awake stone in reach starts the channel; a spent one takes no click', () => {
    const f = pulled();
    const [, a] = f.players;
    const stone = eastStone(f, a);
    atStone(f, a, 2);
    const world = {
      player: a,
      playerId: a.id,
      entities: f.sim.ctx.entities,
      questLog: [],
      targetEntity: (id: number | null) => {
        a.targetId = id;
      },
      interact: () => f.sim.interact(a.id),
      enterDungeon: vi.fn(),
      leaveDungeon: vi.fn(),
      pickUpObject: vi.fn(),
      startAutoAttack: vi.fn(),
    } as unknown as PickInteractionWorld;
    const hud = {
      showError: vi.fn(),
      closeContextMenu: vi.fn(),
      openLoot: vi.fn(),
      openQuestDialog: vi.fn(),
    } as unknown as PickInteractionHud;
    expect(hoverCursorKind(stone, a.id, new Set())).toBe('friendly');
    expect(handlePickedEntity(world, hud, stone.id, 0, 0, 0)).toBe(true);
    expect(a.castingAbility).toBe(ISLE_CASTS.still);
    expect(a.castTargetId).toBe(stone.id);
    f.tick(ticks(5.3));
    expect(f.state()?.isles.isles[2].stilled).toBe(true);
    // Spent: the click only targets, the cursor says nothing, no channel.
    expect(hoverCursorKind(stone, a.id, new Set())).toBe('default');
    expect(handlePickedEntity(world, hud, stone.id, 0, 0, 0)).toBe(false);
    expect(handlePickedEntity(world, hud, stone.id, 2, 0, 0)).toBe(false);
    expect(a.castingAbility).toBeNull();
  });

  it('a click out of reach only targets (no channel, no error line)', () => {
    const f = pulled();
    const [, a] = f.players;
    const stone = eastStone(f, a);
    const use = MOBS[ISLE_MOBS.stillstone]?.trashKit?.usable;
    atStone(f, a, (use?.range ?? 5) + 3);
    const showError = vi.fn();
    const world = {
      player: a,
      playerId: a.id,
      entities: f.sim.ctx.entities,
      questLog: [],
      targetEntity: (id: number | null) => {
        a.targetId = id;
      },
      interact: () => f.sim.interact(a.id),
    } as unknown as PickInteractionWorld;
    const hud = { showError, closeContextMenu: vi.fn() } as unknown as PickInteractionHud;
    expect(handlePickedEntity(world, hud, stone.id, 0, 0, 0)).toBe(false);
    expect(a.targetId).toBe(stone.id);
    expect(a.castingAbility).toBeNull();
    expect(showError).not.toHaveBeenCalled();
  });
});

describe('the isles dev kill', () => {
  it('fells a warded Squall Shieldbearer too (its isle clears, the stone wakes)', () => {
    const f = pulled();
    const [, a] = f.players;
    ride(f, a, -1, 0);
    killIsle(f, 0);
    ride(f, a, 0, 1);
    killIsle(f, 1);
    killIsle(f, 1);
    ride(f, a, 1, 2);
    // The Shieldbearer turned to the guardian: the dev hit lands on its ward.
    const b = f.boss();
    for (const r of f.state()?.isles.adds ?? []) {
      const e = f.sim.ctx.entities.get(r.id);
      if (r.isle !== 2 || !e || e.templateId !== ISLE_MOBS.shieldbearer) continue;
      e.facing = Math.atan2(b.pos.x - e.pos.x, b.pos.z - e.pos.z);
    }
    f.dev('/dev heart breath killisle 2', a.id);
    f.tick(2);
    expect(f.state()?.isles.isles[2].cleared).toBe(true);
    expect(f.state()?.isles.isles[2].stoneId).not.toBeNull();
  });
});

describe("the isles' telegraph objects take no click", () => {
  it('a Closing Storm, an Updraft or any Breath object lets the pick ray pass to the stone', () => {
    expect(takesNoClick({ kind: 'object', templateId: closingTemplate(2, 40, 50) })).toBe(true);
    expect(takesNoClick({ kind: 'object', templateId: padTemplate(1, 2) })).toBe(true);
    expect(takesNoClick({ kind: 'object', templateId: 'sh_breath_vortex' })).toBe(true);
    expect(takesNoClick({ kind: 'mob', templateId: ISLE_MOBS.stillstone })).toBe(false);
    expect(takesNoClick({ kind: 'object', templateId: 'dungeon_door' })).toBe(false);
    expect(takesNoClick({ kind: 'object', templateId: 'sh_council_pillar_0' })).toBe(false);
    const src = readFileSync('src/render/world_picking.ts', 'utf8');
    expect(src).toContain('if (e && takesNoClick(e)) break;');
  });
});
