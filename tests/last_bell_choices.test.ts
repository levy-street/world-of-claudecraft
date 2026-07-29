// Last Bell dialogue choices, sim side (src/sim/scenes/choices.ts): leader
// answer semantics, broadcast prompt/result events with keys only, the flag
// written to every participant's campaignFlags, the default-on-timeout
// window, campaignFlags persistence round-trip, and the scenario choice
// stage gating.
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTIONS, applyAction, encodeObs } from '../src/sim/obs';
import { registerScenario, scenarioRunFor, startScenario } from '../src/sim/scenarios/scenarios';
import { answerSceneChoice, choiceActiveFor, registerChoice } from '../src/sim/scenes/choices';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const QUEST_ID = 'q_fs_hold_the_riftfields';

beforeAll(() => {
  registerChoice({
    id: 'ch_test_vote',
    promptKey: 'lb.q4.vote.prompt',
    flag: 'lastBellVote',
    options: [
      {
        id: 'for',
        key: 'lb.q4.vote.for',
        replyKey: 'lb.q4.vote.for.reply',
        replySpeaker: 'Edda',
      },
      { id: 'against', key: 'lb.q4.vote.against', replyKey: 'lb.q4.vote.against.reply' },
    ],
    windowSeconds: 3,
    defaultOptionId: 'for',
  });
  registerScenario({
    id: 'sc_test_vote',
    dungeonId: 'lb_council',
    questId: QUEST_ID,
    stages: [
      { id: 'vote', objective: { kind: 'choice' }, choiceId: 'ch_test_vote' },
      { id: 'after', objective: { kind: 'survive', seconds: 1 } },
    ],
  });
});

function makeSim(): Sim {
  const sim = new Sim({ seed: 555, playerClass: 'warrior', playerName: 'Bell', devCommands: true });
  sim.player.level = 20;
  sim.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
  return sim;
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function claimIdOf(sim: Sim): number {
  return (
    sim.ctx.instances.find((i) => i.dungeonId === 'lb_council' && i.partyKey !== null)?.exitId ?? -1
  );
}

describe('dialogue choices', () => {
  it('prompts with keys, resolves on the leader answer, writes the flag', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_vote');
    const events = collect(sim, 2);
    const prompt = events.find((e) => e.type === 'sceneChoice');
    expect(prompt && prompt.type === 'sceneChoice' ? prompt.promptKey : '').toBe(
      'lb.q4.vote.prompt',
    );
    expect(prompt && prompt.type === 'sceneChoice' ? prompt.leaderPid : -1).toBe(sim.playerId);
    expect(answerSceneChoice(sim.ctx, 'ch_test_vote', 'against')).toBe(true);
    expect(sim.ctx.players.get(sim.playerId)?.campaignFlags.get('lastBellVote')).toBe('against');
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
    // The stage advances once the choice resolves.
    collect(sim, 2);
    expect(scenarioRunFor(sim.ctx, claimIdOf(sim))?.stageIndex).toBe(1);
  });

  it('exposes bounded indexed choices and their availability to headless agents', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_vote');
    collect(sim, 2);
    const controls = encodeObs(sim).slice(-8);
    expect(controls.slice(0, 3)).toEqual([0, 1, 1]);
    expect(controls[3]).toBeGreaterThan(0);
    expect(controls.slice(4)).toEqual([1, 1, 0, 0]);

    applyAction(sim, ACTIONS.indexOf('scene_choice_4'));
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(true);
    applyAction(sim, ACTIONS.indexOf('scene_choice_1'));
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
    expect(sim.ctx.players.get(sim.playerId)?.campaignFlags.get('lastBellVote')).toBe('for');
    expect(encodeObs(sim).slice(-8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('reports authoritative active and resolved choice state for reconnect', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_vote');
    collect(sim, 2);
    expect(sim.sceneChoiceReconnectStateFor(sim.playerId)).toMatchObject({
      choiceId: 'ch_test_vote',
      promptKey: 'lb.q4.vote.prompt',
      leaderPid: sim.playerId,
      windowSeconds: 3,
      options: [
        { id: 'for', key: 'lb.q4.vote.for' },
        { id: 'against', key: 'lb.q4.vote.against' },
      ],
    });
    expect(sim.sceneChoiceReconnectStateFor(sim.playerId)?.remainingSeconds).toBeGreaterThan(0);
    answerSceneChoice(sim.ctx, 'ch_test_vote', 'for');
    expect(sim.sceneChoiceReconnectStateFor(sim.playerId)).toBeNull();
  });

  it('broadcasts the result with the reply key to every participant', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_vote');
    collect(sim, 2);
    answerSceneChoice(sim.ctx, 'ch_test_vote', 'for');
    const events = collect(sim, 1);
    void events;
    // The result event was emitted synchronously with the answer; drain from
    // the answer tick instead.
    const sim2 = makeSim();
    startScenario(sim2.ctx, 'sc_test_vote');
    collect(sim2, 2);
    answerSceneChoice(sim2.ctx, 'ch_test_vote', 'for');
    const drained = sim2.tick();
    // Events emitted between ticks surface on the next tick's drain in the
    // offline host.
    expect(drained).toContainEqual({
      type: 'sceneChoiceResult',
      choiceId: 'ch_test_vote',
      optionId: 'for',
      replyKey: 'lb.q4.vote.for.reply',
      replySpeaker: 'Edda',
      pid: sim2.playerId,
    });
    expect(sim2.ctx.players.get(sim2.playerId)?.campaignFlags.get('lastBellVote')).toBe('for');
  });

  it('a non-leader answer is ignored; the leader decides for the party', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bet');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.ctx.players
      .get(b)
      ?.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });
    startScenario(sim.ctx, 'sc_test_vote', a);
    startScenario(sim.ctx, 'sc_test_vote', b);
    collect(sim, 2);
    // b is not the leader: their answer must not resolve the choice.
    expect(answerSceneChoice(sim.ctx, 'ch_test_vote', 'against', b)).toBe(false);
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(true);
    expect(answerSceneChoice(sim.ctx, 'ch_test_vote', 'against', a)).toBe(true);
    // Both members carry the record.
    expect(sim.ctx.players.get(a)?.campaignFlags.get('lastBellVote')).toBe('against');
    expect(sim.ctx.players.get(b)?.campaignFlags.get('lastBellVote')).toBe('against');
    const results = sim.tick().filter((event) => event.type === 'sceneChoiceResult');
    expect(results).toEqual([
      {
        type: 'sceneChoiceResult',
        choiceId: 'ch_test_vote',
        optionId: 'against',
        replyKey: 'lb.q4.vote.against.reply',
        replySpeaker: undefined,
        pid: a,
      },
      {
        type: 'sceneChoiceResult',
        choiceId: 'ch_test_vote',
        optionId: 'against',
        replyKey: 'lb.q4.vote.against.reply',
        replySpeaker: undefined,
        pid: b,
      },
    ]);
  });

  it('routes a shared choice id to the answering leader’s own story claim', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bet');
    sim.ctx.players
      .get(b)
      ?.questLog.set(QUEST_ID, { questId: QUEST_ID, counts: [0], state: 'active' });

    expect(startScenario(sim.ctx, 'sc_test_vote', a)).toBe(true);
    expect(startScenario(sim.ctx, 'sc_test_vote', b)).toBe(true);
    collect(sim, 2);

    const claims = [...sim.ctx.activeChoices.values()].filter(
      (choice) => choice.choiceId === 'ch_test_vote',
    );
    expect(claims.map((choice) => choice.leaderPid).sort((x, y) => x - y)).toEqual(
      [a, b].sort((x, y) => x - y),
    );

    expect(answerSceneChoice(sim.ctx, 'ch_test_vote', 'against', b)).toBe(true);
    expect(sim.ctx.players.get(b)?.campaignFlags.get('lastBellVote')).toBe('against');
    expect(sim.ctx.players.get(a)?.campaignFlags.has('lastBellVote')).toBe(false);
    expect([...sim.ctx.activeChoices.values()].map((choice) => choice.leaderPid)).toEqual([a]);

    expect(answerSceneChoice(sim.ctx, 'ch_test_vote', 'for', a)).toBe(true);
    expect(sim.ctx.players.get(a)?.campaignFlags.get('lastBellVote')).toBe('for');
    expect(sim.ctx.activeChoices.size).toBe(0);
  });

  it('the window closes on the default so a scene never deadlocks', () => {
    const sim = makeSim();
    startScenario(sim.ctx, 'sc_test_vote');
    collect(sim, 2);
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(true);
    collect(sim, 3 * 20 + 5);
    expect(choiceActiveFor(sim.ctx, claimIdOf(sim))).toBe(false);
    expect(sim.ctx.players.get(sim.playerId)?.campaignFlags.get('lastBellVote')).toBe('for');
  });

  it('campaignFlags survive the character save/load round trip', () => {
    const sim = makeSim();
    sim.ctx.players.get(sim.playerId)?.campaignFlags.set('lastBellVote', 'against');
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.campaignFlags).toEqual([['lastBellVote', 'against']]);
    const sim2 = new Sim({ seed: 556, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Bell', { state: saved ?? undefined });
    expect(sim2.ctx.players.get(pid)?.campaignFlags.get('lastBellVote')).toBe('against');
  });
});
