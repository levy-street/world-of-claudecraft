// The ferry fare (H2) through the real Sim: talking to a gangplank keeper
// opens a PERSONAL fare prompt (audience of one, keyed -pid; the client's
// gossip button drives talk + 'pay' in one click), paying charges the purse
// and crosses, declining (by answer, by walking away, or by timeout) leaves
// the rider on the dock unchanged, a broke first-timer rides free exactly
// once, party members pay individually (no leader-answers on the dock), and
// the return leg charges the same fare.
import { describe, expect, it } from 'vitest';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import {
  FERRY_FARE_COPPER,
  ferryFareOfferFor,
  tryLastBellNpcTalk,
} from '../src/sim/last_bell/campaign';
import { answerSceneChoice } from '../src/sim/scenes/choices';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const Q0 = 'q_lb_q0_ashore';
const OUT = 'ch_lb_ferry_fare_out';
const BACK = 'ch_lb_ferry_fare_back';

function makeSim(): Sim {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
  sim.player.level = 6;
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.rebucket(sim.player);
}

function keeper(sim: Sim, templateId: string): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.templateId === templateId);
}

function boardMainland(sim: Sim): void {
  teleport(sim, 238, -47.5);
  const ewald = keeper(sim, 'ferryman_ewald');
  expect(ewald).toBeTruthy();
  sim.player.targetId = ewald?.id ?? null;
  sim.interact();
}

function boardGullhaven(sim: Sim): void {
  teleport(sim, 727, 131);
  const odda = keeper(sim, 'ferrykeeper_odda');
  expect(odda).toBeTruthy();
  sim.player.targetId = odda?.id ?? null;
  sim.interact();
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('the ferry fare', () => {
  it('boarding opens a personal prompt with the price; paying charges and crosses', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    expect(meta).toBeTruthy();
    if (!meta) return;
    meta.copper = 50;
    boardMainland(sim);
    // The prompt is personal: keyed -pid, leader is the rider.
    const active = sim.ctx.activeChoices.get(-sim.playerId);
    expect(active?.choiceId).toBe(OUT);
    expect(active?.audiencePid).toBe(sim.playerId);
    const events = collect(sim, 1);
    const prompt = events.find((e): e is Extract<SimEvent, { type: 'sceneChoice' }> => {
      return e.type === 'sceneChoice';
    });
    expect(prompt?.choiceId).toBe(OUT);
    expect(prompt?.leaderPid).toBe(sim.playerId);
    expect(prompt?.values).toEqual({ price: FERRY_FARE_COPPER });
    // No crossing until the answer.
    expect(sim.player.pos.x).toBeGreaterThan(200);
    expect(answerSceneChoice(sim.ctx, OUT, 'pay')).toBe(true);
    expect(meta.copper).toBe(50 - FERRY_FARE_COPPER);
    expect(
      Math.hypot(
        sim.player.pos.x - GULLHAVEN_HARBOR.deckArrival.x,
        sim.player.pos.z - GULLHAVEN_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);
    expect(sim.questLog.get(Q0)?.state).toBe('active');
    // The dock transaction writes no campaign flag (personal arm contract).
    expect(meta.campaignFlags.has('lb_ferry_fare')).toBe(false);
  });

  it('declining leaves you on the dock with your copper', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 50;
    boardMainland(sim);
    expect(answerSceneChoice(sim.ctx, OUT, 'decline')).toBe(true);
    expect(meta.copper).toBe(50);
    expect(sim.player.pos.x).toBeGreaterThan(200);
    expect(sim.ctx.activeChoices.size).toBe(0);
    expect(sim.questLog.has(Q0)).toBe(false);
  });

  it('a broke first-timer rides free once; a broke return is refused', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 0;
    boardMainland(sim);
    expect(answerSceneChoice(sim.ctx, OUT, 'pay')).toBe(true);
    const events = collect(sim, 1);
    expect(
      events.some(
        (e) =>
          e.type === 'log' &&
          e.text === "Ewald waves the fare away. The first crossing is the town's.",
      ),
    ).toBe(true);
    expect(meta.copper).toBe(0);
    expect(sim.player.pos.x).toBeGreaterThan(600);
    expect(sim.questLog.get(Q0)?.state).toBe('active');
    // The waiver is first-crossing only: the broke return leg is refused and
    // the rider stays on the island.
    boardGullhaven(sim);
    expect(answerSceneChoice(sim.ctx, BACK, 'pay')).toBe(true);
    const refusal = collect(sim, 1);
    expect(refusal.some((e) => e.type === 'error' && e.text === 'Not enough money.')).toBe(true);
    expect(sim.player.pos.x).toBeGreaterThan(600);
  });

  it('party members pay individually; a neighbor prompt never eats an answer', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bet');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    const metaA = sim.ctx.players.get(a);
    const metaB = sim.ctx.players.get(b);
    if (!metaA || !metaB) return;
    metaA.copper = 40;
    metaB.copper = 40;
    boardMainland(sim);
    const ewald = keeper(sim, 'ferryman_ewald');
    const entB = sim.entities.get(b);
    if (!ewald || !entB) return;
    entB.pos = { ...sim.player.pos };
    entB.prevPos = { ...sim.player.pos };
    sim.rebucket(entB);
    expect(tryLastBellNpcTalk(sim.ctx, ewald, b)).toBe(true);
    // Two personal prompts, one per rider.
    expect(sim.ctx.activeChoices.get(-a)?.choiceId).toBe(OUT);
    expect(sim.ctx.activeChoices.get(-b)?.choiceId).toBe(OUT);
    // B answers while A's prompt (same choiceId) is live: B's own prompt
    // resolves, B alone is charged, A's prompt stays open.
    expect(answerSceneChoice(sim.ctx, OUT, 'pay', b)).toBe(true);
    expect(metaB.copper).toBe(40 - FERRY_FARE_COPPER);
    expect(metaA.copper).toBe(40);
    expect(sim.ctx.activeChoices.get(-a)?.choiceId).toBe(OUT);
    expect(answerSceneChoice(sim.ctx, OUT, 'pay', a)).toBe(true);
    expect(metaA.copper).toBe(40 - FERRY_FARE_COPPER);
  });

  it('the return leg charges the same fare back to the mainland', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 30;
    // Arrive as a paying rider so Q0 is active, then ride back.
    boardMainland(sim);
    expect(answerSceneChoice(sim.ctx, OUT, 'pay')).toBe(true);
    boardGullhaven(sim);
    expect(answerSceneChoice(sim.ctx, BACK, 'pay')).toBe(true);
    expect(meta.copper).toBe(30 - 2 * FERRY_FARE_COPPER);
    expect(
      Math.hypot(
        sim.player.pos.x - MAINLAND_HARBOR.deckArrival.x,
        sim.player.pos.z - MAINLAND_HARBOR.deckArrival.z,
      ),
    ).toBeLessThan(3);
  });

  it('walking away from the dock is declining', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 50;
    boardMainland(sim);
    expect(sim.ctx.activeChoices.get(-sim.playerId)).toBeTruthy();
    // Drift past the personal-choice anchor radius and tick once.
    teleport(sim, 220, -47.5);
    collect(sim, 2);
    expect(sim.ctx.activeChoices.size).toBe(0);
    expect(meta.copper).toBe(50);
    expect(sim.questLog.has(Q0)).toBe(false);
  });

  it('the response window times out to decline', () => {
    const sim = makeSim();
    const meta = sim.ctx.players.get(sim.playerId);
    if (!meta) return;
    meta.copper = 50;
    boardMainland(sim);
    collect(sim, 26 * 20);
    expect(sim.ctx.activeChoices.size).toBe(0);
    expect(meta.copper).toBe(50);
    expect(sim.player.pos.x).toBeGreaterThan(200);
  });

  it('talking to either gangplank keeper opens the fare; the offer map pins both', () => {
    // The one source of truth the gossip button and the sim talk arm share.
    expect(ferryFareOfferFor('ferryman_ewald')).toEqual({
      choiceId: OUT,
      promptKey: 'lb.fare.promptOut',
    });
    expect(ferryFareOfferFor('ferrykeeper_odda')).toEqual({
      choiceId: BACK,
      promptKey: 'lb.fare.promptBack',
    });
    expect(ferryFareOfferFor('sergeant_marsh')).toBeNull();
    const sim = makeSim();
    const ewald = [...sim.entities.values()].find((e) => e.templateId === 'ferryman_ewald');
    expect(ewald).toBeTruthy();
    if (!ewald) return;
    teleport(sim, ewald.pos.x + 1, ewald.pos.z + 1);
    sim.player.targetId = ewald.id;
    sim.interact();
    expect(sim.ctx.activeChoices.get(-sim.playerId)?.choiceId).toBe(OUT);
    expect(answerSceneChoice(sim.ctx, OUT, 'decline')).toBe(true);

    const odda = [...sim.entities.values()].find((e) => e.templateId === 'ferrykeeper_odda');
    expect(odda).toBeTruthy();
    if (!odda) return;
    teleport(sim, odda.pos.x + 1, odda.pos.z + 1);
    sim.player.targetId = odda.id;
    sim.interact();
    expect(sim.ctx.activeChoices.get(-sim.playerId)?.choiceId).toBe(BACK);
  });
});
