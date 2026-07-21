// Retail-style, character-bound combo points: the pool survives a target swap
// and the combo target's death, finishes on whatever the player targets next,
// and fades 30 seconds after the last point was built (awardCombo restamps the
// window on every award). Pairs with src/sim/sim.ts awardCombo +
// src/sim/combat/auras.ts updateComboExpiry.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const makeSim = () => new Sim({ seed: 42, playerClass: 'rogue', autoEquip: true });

function nearestMobs(sim: Sim, templateId: string, count: number) {
  const p = sim.player;
  return [...sim.entities.values()]
    .filter((e) => e.kind === 'mob' && !e.dead && e.templateId === templateId)
    .sort((a, b) => dist2d(p.pos, a.pos) - dist2d(p.pos, b.pos))
    .slice(0, count);
}

function teleportTo(sim: Sim, x: number, z: number) {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vz = 0;
  p.vy = 0;
  p.onGround = true;
  p.fallStartY = p.pos.y;
}

function facePlayerAt(sim: Sim, target: { pos: { x: number; z: number } }) {
  sim.player.facing = Math.atan2(target.pos.x - sim.player.pos.x, target.pos.z - sim.player.pos.z);
}

// Build combo points on the current target with sinister strike (the natural
// awardCombo path), so comboUntil is stamped exactly as in live play.
function buildCombo(sim: Sim, target: any, points: number) {
  let guard = 0;
  while (sim.player.comboPoints < points && guard++ < 20 * 120 && !target.dead) {
    sim.player.resource = 100;
    if (sim.player.gcdRemaining <= 0) sim.castAbility('sinister_strike');
    sim.tick();
    facePlayerAt(sim, target);
    target.hp = target.maxHp; // the dummy must survive the build
  }
  expect(sim.player.comboPoints).toBeGreaterThanOrEqual(points);
}

describe('character-bound combo points (retail-style)', () => {
  it('survive a target swap and spend on the NEW target', () => {
    const sim = makeSim();
    const [wolfA, wolfB] = nearestMobs(sim, 'forest_wolf', 2);
    expect(wolfB).toBeTruthy();
    teleportTo(sim, wolfA.pos.x + 2, wolfA.pos.z);
    sim.targetEntity(wolfA.id);
    facePlayerAt(sim, wolfA);
    buildCombo(sim, wolfA, 2);
    const banked = sim.player.comboPoints;

    // swap to a second wolf: the pool must NOT reset (the classic rule is gone)
    wolfB.pos.x = sim.player.pos.x + 2;
    wolfB.pos.z = sim.player.pos.z;
    wolfB.hp = wolfB.maxHp = 500;
    sim.targetEntity(wolfB.id);
    sim.tick();
    expect(sim.player.comboPoints).toBe(banked);

    // and the finisher spends them on the new target, no "requires combo points"
    sim.player.resource = 100;
    for (let i = 0; i < 32; i++) sim.tick(); // clear the GCD
    facePlayerAt(sim, wolfB);
    const hp0 = wolfB.hp;
    sim.castAbility('eviscerate');
    const ev = sim.tick();
    expect(ev.some((e) => e.type === 'error' && /requires combo points/.test(e.text))).toBe(false);
    expect(wolfB.hp).toBeLessThan(hp0);
    expect(sim.player.comboPoints).toBe(0);
  });

  it('survive the combo target dying (carry to the next fight)', () => {
    const sim = makeSim();
    const [wolf] = nearestMobs(sim, 'forest_wolf', 1);
    teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    facePlayerAt(sim, wolf);
    buildCombo(sim, wolf, 2);
    const banked = sim.player.comboPoints;

    // finish the wolf off with auto-attacks (no finisher: the pool stays banked)
    wolf.hp = 1;
    sim.startAutoAttack();
    let guard = 0;
    while (!wolf.dead && guard++ < 20 * 30) {
      facePlayerAt(sim, wolf);
      sim.tick();
    }
    expect(wolf.dead).toBe(true);
    expect(sim.player.comboPoints).toBe(banked);
  });

  it('fade 30 seconds after the last point was built, with a comboPoint 0 event', () => {
    const sim = makeSim();
    const [wolf] = nearestMobs(sim, 'forest_wolf', 1);
    teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    facePlayerAt(sim, wolf);
    buildCombo(sim, wolf, 1);
    const banked = sim.player.comboPoints;
    sim.stopAutoAttack();
    sim.targetEntity(null); // disengage: nothing refreshes the pool

    // still banked just inside the window (god-mode hp: dying clears the pool
    // through the death path, which is not what this test pins)
    for (let i = 0; i < 20 * 29; i++) {
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    expect(sim.player.comboPoints).toBe(banked);

    // gone just past it, announced by the comboPoint 0 event
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 2; i++) {
      sim.player.hp = sim.player.maxHp;
      events.push(...sim.tick());
    }
    expect(sim.player.comboPoints).toBe(0);
    expect(events.some((e) => e.type === 'comboPoint' && e.points === 0)).toBe(true);
  });

  it('each new point restamps the fade window', () => {
    const sim = makeSim();
    const [wolf] = nearestMobs(sim, 'forest_wolf', 1);
    teleportTo(sim, wolf.pos.x + 2, wolf.pos.z);
    sim.targetEntity(wolf.id);
    facePlayerAt(sim, wolf);
    buildCombo(sim, wolf, 1);

    // 20 seconds pass, then a fresh point restamps the 30-second window
    for (let i = 0; i < 20 * 20; i++) {
      sim.player.hp = sim.player.maxHp;
      sim.tick();
      wolf.hp = wolf.maxHp;
    }
    expect(sim.player.comboPoints).toBeGreaterThanOrEqual(1);
    const before = sim.player.comboPoints;
    buildCombo(sim, wolf, before + 1);

    // 20 more seconds (40 since the FIRST point): still banked, the restamp held
    sim.stopAutoAttack();
    sim.targetEntity(null);
    for (let i = 0; i < 20 * 20; i++) {
      sim.player.hp = sim.player.maxHp;
      sim.tick();
    }
    expect(sim.player.comboPoints).toBeGreaterThanOrEqual(before + 1);
  });
});
