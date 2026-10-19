// The Gurglegreen Cauldron (Hester's toy, round 10; sim: seasonal/toy_cauldron.ts). Pinned
// here: its user sets a ground object down in front of them for `standsFor` seconds; ANY
// player in reach may drink from it (the ordinary object interaction, the same command
// online and off) and turns into a goblin for the toy's duration (round 11: a cosmetic
// aura and nothing else, a body swap on the costumes' seam: one body at a time, combat
// ends it); a fresh cauldron replaces its maker's last; refused in combat, in stealth and
// out of season; it leaves the world when its time runs out and when the event closes; no
// rng.
import { afterEach, describe, expect, it } from 'vitest';
import { wireEntity } from '../server/game';
import { applyAuraWire, type ClientWireAura } from '../src/net/aura_wire_decode';
import {
  characterFormAssetKey,
  characterFormMaskForAura,
  requestedCharacterForm,
} from '../src/render/characters/form_visual_selection_core';
import {
  GOURDLIGHT_COSTUMES,
  GOURDLIGHT_TOYS,
  type GourdlightToy,
  GURGLEGREEN_CAULDRON_ID,
} from '../src/sim/content/gourdlight_eve';
import {
  isToyCauldron,
  TOY_CAULDRON_DRINK_FX,
  TOY_CAULDRON_DRINK_SFX,
  TOY_CAULDRON_PLACE_REACH,
  TOY_FX_ABILITY_PREFIX,
  TOY_SFX,
} from '../src/sim/seasonal';
import { syncSeasonalDecorColliders } from '../src/sim/seasonal_decor_colliders';
import { Sim } from '../src/sim/sim';
import { DT, dist2d, type Entity, type SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => syncSeasonalDecorColliders(WORLD_SEED, null));

const CAULDRON = GOURDLIGHT_TOYS.find((t) => t.effect === 'cauldron') as GourdlightToy;

function world(): Sim {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-10-20';
  sim.chat('/dev season on');
  sim.tick();
  return sim;
}

function friend(sim: Sim, dist: number): Entity {
  const pid = sim.addPlayer('mage', 'Pip');
  const e = sim.entities.get(pid) as Entity;
  e.pos = { ...sim.player.pos, x: sim.player.pos.x + dist };
  return e;
}

const pots = (sim: Sim) => [...sim.entities.values()].filter((e) => isToyCauldron(e));
const brewOn = (e: Entity) => e.auras.find((a) => a.id === CAULDRON.auraId);
// biome-ignore lint/suspicious/noExplicitAny: the rng's raw state, for the draw-count pin
const rngState = (sim: Sim) => (sim as any).rng.s as number;
const ticks = (sim: Sim, seconds: number) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...sim.tick());
  return out;
};

function place(sim: Sim): Entity {
  sim.addItem(GURGLEGREEN_CAULDRON_ID, 1);
  sim.useItem(GURGLEGREEN_CAULDRON_ID);
  const [pot] = pots(sim);
  return pot;
}

describe('the Gurglegreen Cauldron', () => {
  it('is a cosmetic toy record: a drink look, a standing time, its own sounds', () => {
    expect(CAULDRON.itemId).toBe(GURGLEGREEN_CAULDRON_ID);
    expect(CAULDRON.itemName).toBe('Gurglegreen Cauldron');
    expect(CAULDRON.standsFor).toBe(60);
    // the goblin lasts 45 s (owner direction: 30 to 60)
    expect(CAULDRON.duration).toBe(45);
    expect(CAULDRON.cooldown).toBeGreaterThan(CAULDRON.standsFor ?? 0);
    expect(TOY_SFX.cauldron).toBe('spell_gurglegreen_cauldron');
    expect(TOY_CAULDRON_DRINK_SFX).toBe('spell_gurglegreen_quaff');
  });

  it('sets a cauldron down in front of its user, never consumed, cooldown started', () => {
    const sim = world();
    const before = rngState(sim);
    const pot = place(sim);
    expect(rngState(sim)).toBe(before);
    expect(pot?.kind).toBe('object');
    expect(pot.templateId).toBe(`ground_${GURGLEGREEN_CAULDRON_ID}`);
    // clear of its user's feet now that it is drawn waist-high and a yard round
    expect(TOY_CAULDRON_PLACE_REACH).toBeGreaterThanOrEqual(2);
    expect(dist2d(pot.pos, sim.player.pos)).toBeCloseTo(TOY_CAULDRON_PLACE_REACH, 1);
    expect(pot.despawnTimer).toBe(CAULDRON.standsFor);
    expect(sim.countItem(GURGLEGREEN_CAULDRON_ID)).toBe(1);
    expect(sim.player.cooldowns.get(GURGLEGREEN_CAULDRON_ID)).toBe(CAULDRON.cooldown);
    // the user wears nothing: the look is the drinker's
    expect(brewOn(sim.player)).toBeUndefined();
    const events = sim.tick();
    const cue = events.find(
      (e): e is Extract<SimEvent, { type: 'spellfxAt' }> =>
        e.type === 'spellfxAt' && e.ability === `${TOY_FX_ABILITY_PREFIX}cauldron`,
    );
    expect(cue?.x).toBe(pot.pos.x);
    expect(cue?.z).toBe(pot.pos.z);
    expect(cue?.sfxKey).toBe(TOY_SFX.cauldron);
  });

  it('anyone in reach drinks: a goblin for the toy duration, and nothing else', () => {
    const sim = world();
    const pot = place(sim);
    const pip = friend(sim, 2.5);
    const sheet = JSON.stringify([pip.stats, pip.maxHp, pip.hp, pip.resource, pip.moveSpeed]);
    const before = rngState(sim);
    expect(sim.pickUpObject(pot.id, pip.id)).toBe(true);
    expect(rngState(sim)).toBe(before);
    const brew = brewOn(pip);
    expect(brew?.kind).toBe('seasonal_cosmetic');
    expect(brew?.duration).toBe(CAULDRON.duration);
    expect(brew?.undispellable).toBe(true);
    expect(brew?.sourceId).toBe(sim.player.id);
    const events = sim.tick();
    expect(
      events.some((e) => e.type === 'seasonal' && e.what === 'cauldronDrink' && e.pid === pip.id),
    ).toBe(true);
    const cue = events.find(
      (e): e is Extract<SimEvent, { type: 'spellfxAt' }> =>
        e.type === 'spellfxAt' && e.ability === TOY_CAULDRON_DRINK_FX,
    );
    expect(cue?.targetId).toBe(pip.id);
    expect(cue?.sfxKey).toBe(TOY_CAULDRON_DRINK_SFX);
    expect(JSON.stringify([pip.stats, pip.maxHp, pip.hp, pip.resource, pip.moveSpeed])).toBe(sheet);
    // the cauldron stays for the next drinker, and its maker may drink too
    expect(pots(sim)).toHaveLength(1);
    expect(sim.pickUpObject(pot.id)).toBe(true);
    expect(brewOn(sim.player)).toBeDefined();
    ticks(sim, CAULDRON.duration + 0.2);
    expect(brewOn(pip)).toBeUndefined();
  });

  it('refuses a drinker out of reach, in combat or hidden in stealth', () => {
    const sim = world();
    const pot = place(sim);
    const far = friend(sim, 12);
    expect(sim.pickUpObject(pot.id, far.id)).toBe(false);
    expect(brewOn(far)).toBeUndefined();
    const pip = friend(sim, 2.5);
    pip.inCombat = true;
    sim.pickUpObject(pot.id, pip.id);
    expect(brewOn(pip)).toBeUndefined();
    pip.inCombat = false;
    pip.stealthed = true;
    sim.pickUpObject(pot.id, pip.id);
    expect(brewOn(pip)).toBeUndefined();
    expect(sim.tick().some((e) => e.type === 'seasonal' && e.what === 'toyHidden')).toBe(true);
  });

  it('one per maker: a fresh one replaces the last; it leaves when its time runs out', () => {
    const sim = world();
    const first = place(sim);
    sim.player.cooldowns.delete(GURGLEGREEN_CAULDRON_ID);
    sim.useItem(GURGLEGREEN_CAULDRON_ID);
    const live = pots(sim);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(first.id);
    expect(sim.entities.has(first.id)).toBe(false);
    // its full minute, fast-forwarded to the last half second
    expect(live[0].despawnTimer).toBe(CAULDRON.standsFor);
    live[0].despawnTimer = 0.4;
    ticks(sim, 0.5);
    expect(pots(sim)).toHaveLength(0);
    expect(sim.seasonal.toyCauldrons.size).toBe(0);
  });

  it('is cleared from the world when Gourdlight Eve closes', () => {
    const sim = world();
    place(sim);
    sim.tick();
    expect(pots(sim)).toHaveLength(1);
    sim.chat('/dev season off');
    sim.tick();
    expect(pots(sim)).toHaveLength(0);
    expect(sim.seasonal.toyCauldrons.size).toBe(0);
  });

  it('the goblin is a costume: it takes a costume off, a costume takes it off, combat ends it', () => {
    const sim = world();
    const pot = place(sim);
    const pip = friend(sim, 2.5);
    const skeleton = GOURDLIGHT_COSTUMES[0];
    pip.auras.push({
      id: skeleton.auraId,
      name: skeleton.name,
      kind: 'seasonal_cosmetic',
      value: 0,
      remaining: 600,
      duration: 600,
      undispellable: true,
      sourceId: pip.id,
      school: 'physical',
    });
    expect(sim.pickUpObject(pot.id, pip.id)).toBe(true);
    // one body at a time: the goblin replaced the skeleton
    expect(brewOn(pip)).toBeDefined();
    expect(pip.auras.some((a) => a.id === skeleton.auraId)).toBe(false);
    // a fresh sip starts the goblin's time over, never stacks a second one
    ticks(sim, 5);
    expect(sim.pickUpObject(pot.id, pip.id)).toBe(true);
    expect(pip.auras.filter((a) => a.id === CAULDRON.auraId)).toHaveLength(1);
    expect(brewOn(pip)?.remaining).toBeCloseTo(CAULDRON.duration, 0);
    // a fight starting ends it (the trick bodies' rule, seasonal_tick.ts)
    pip.inCombat = true;
    pip.combatTimer = 0;
    sim.tick();
    expect(brewOn(pip)).toBeUndefined();
  });

  it('the goblin lasts its full time, then the drinker is themselves again', () => {
    const sim = world();
    const pot = place(sim);
    expect(sim.pickUpObject(pot.id)).toBe(true);
    ticks(sim, CAULDRON.duration - 1);
    expect(brewOn(sim.player)).toBeDefined();
    ticks(sim, 1.2);
    expect(brewOn(sim.player)).toBeUndefined();
  });

  it('online: the drinker goblin rides the snapshot, so every client draws the goblin', () => {
    // the server's sim: Pip drinks from the maker's cauldron
    const sim = world();
    const pot = place(sim);
    const pip = friend(sim, 2.5);
    expect(sim.pickUpObject(pot.id, pip.id)).toBe(true);
    // what the server sends ANOTHER client about Pip (the interest-scoped entity row)
    const row = wireEntity(pip) as { auras?: ClientWireAura[] };
    const sent = (row.auras ?? []).find((a) => a.id === CAULDRON.auraId);
    expect(sent?.kind).toBe('seasonal_cosmetic');
    // that client decodes the row and picks Pip's body from it: the goblin
    const held = applyAuraWire([], row.auras ?? [], { mode: 'legacy', time: null });
    const mask = held.reduce((m, a) => m | characterFormMaskForAura(a), 0);
    expect(requestedCharacterForm(mask)).toBe('sheep');
    expect(characterFormAssetKey('form_sheep', held)).toBe('form_costume_goblin');
  });
});
