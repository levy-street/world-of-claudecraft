import { describe, expect, it } from 'vitest';
import {
  behaviorEventBody,
  behaviorEventInputsFromSimEvent,
  GlitchBehaviorTracker,
  merchantBehaviorEventInputs,
  talkBehaviorEventInputs,
} from '../src/game/glitch_events';
import type { SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

function world(overrides: Record<string, unknown> = {}): IWorld {
  return {
    player: {
      id: 1,
      templateId: 'mage',
      level: 1,
      hp: 45,
      maxHp: 90,
      inCombat: false,
      dead: false,
      ghost: false,
      pos: { x: 12, y: 0, z: 0 },
      ...overrides,
    },
  } as unknown as IWorld;
}

describe('Glitch behavioral events', () => {
  it('normalizes event keys and keeps metadata scalar-only', () => {
    expect(
      behaviorEventBody({
        stepKey: 'Quest Complete!',
        actionKey: 'Ready Now',
        metadata: {
          Count: 1.23456,
          ok: true,
          none: null,
          nested: { no: 'objects' },
          label: 'x'.repeat(200),
        },
        timestamp: '2026-07-05T12:00:00.000Z',
      }),
    ).toEqual({
      step_key: 'quest_complete',
      action_key: 'ready_now',
      metadata: {
        count: 1.235,
        ok: true,
        none: null,
        label: 'x'.repeat(160),
      },
      event_timestamp: '2026-07-05T12:00:00.000Z',
    });
  });

  it('maps progression and friction sim events to stable step/action keys', () => {
    const input: SimEvent[] = [
      {
        type: 'damage',
        sourceId: 1,
        targetId: 2,
        amount: 5,
        crit: false,
        school: 'physical',
        ability: null,
        kind: 'hit',
      },
      { type: 'questDone', questId: 'q_wolves' },
      { type: 'levelup', level: 2 },
      { type: 'lockpickEnd', sessionId: 'lp-1', outcome: 'fail' },
      { type: 'delveFailed', delveId: 'drowned_litany', tierId: 't1' },
    ];

    expect(input.flatMap((ev) => behaviorEventInputsFromSimEvent(ev, world()))).toEqual([
      {
        stepKey: 'quest',
        actionKey: 'complete',
        metadata: { quest_id: 'q_wolves', quest_stage: 'complete' },
      },
      {
        stepKey: 'quest_q_wolves_complete',
        actionKey: 'reach',
        metadata: { quest_id: 'q_wolves', quest_stage: 'complete' },
      },
      { stepKey: 'level_02', actionKey: 'reach', metadata: { level: 2 } },
      {
        stepKey: 'lockpick',
        actionKey: 'fail',
        metadata: { session_id: 'lp-1', loot_tier: null },
      },
      {
        stepKey: 'delve',
        actionKey: 'fail',
        metadata: { delve_id: 'drowned_litany', tier_id: 't1' },
      },
    ]);
  });

  it('maps talk and merchant interactions to funnel stage keys', () => {
    expect(
      talkBehaviorEventInputs({
        kind: 'option',
        npcId: 'marshal_redbrook',
        npcEntityId: 12,
        optionKey: 'quest_offer_detail',
        questId: 'q_wolves',
        questState: 'available',
      }),
    ).toEqual([
      {
        stepKey: 'talk_option',
        actionKey: 'select_quest_offer_detail',
        metadata: {
          npc_id: 'marshal_redbrook',
          npc_entity_id: 12,
          option_key: 'quest_offer_detail',
          quest_id: 'q_wolves',
          quest_state: 'available',
          quest_count: undefined,
          has_vendor: undefined,
          has_market: undefined,
          source: undefined,
        },
      },
      {
        stepKey: 'quest',
        actionKey: 'view_detail',
        metadata: {
          quest_id: 'q_wolves',
          quest_stage: 'detail',
          npc_id: 'marshal_redbrook',
          npc_entity_id: 12,
          option_key: 'quest_offer_detail',
          quest_state: 'available',
          quest_count: undefined,
          has_vendor: undefined,
          has_market: undefined,
          source: undefined,
        },
      },
      {
        stepKey: 'quest_q_wolves_detail',
        actionKey: 'reach',
        metadata: {
          quest_id: 'q_wolves',
          quest_stage: 'detail',
          npc_id: 'marshal_redbrook',
          npc_entity_id: 12,
          option_key: 'quest_offer_detail',
          quest_state: 'available',
          quest_count: undefined,
          has_vendor: undefined,
          has_market: undefined,
          source: undefined,
        },
      },
    ]);

    expect(
      merchantBehaviorEventInputs({
        kind: 'option',
        merchantType: 'vendor',
        vendorId: 'trader_wilkes',
        vendorEntityId: 18,
        optionKey: 'buy',
        itemId: 'hearth_bread',
      }),
    ).toEqual([
      {
        stepKey: 'merchant_option',
        actionKey: 'buy',
        metadata: {
          merchant_type: 'vendor',
          vendor_id: 'trader_wilkes',
          vendor_entity_id: 18,
          option_key: 'buy',
          item_id: 'hearth_bread',
          stock_count: undefined,
          buyback_count: undefined,
          proceeds: undefined,
          source: undefined,
        },
      },
      {
        stepKey: 'merchant_buy',
        actionKey: 'attempt',
        metadata: {
          merchant_type: 'vendor',
          vendor_id: 'trader_wilkes',
          vendor_entity_id: 18,
          option_key: 'buy',
          item_id: 'hearth_bread',
          stock_count: undefined,
          buyback_count: undefined,
          proceeds: undefined,
          source: undefined,
        },
      },
    ]);
  });

  it('tracks world progression, first input, and throttled xp without blocking play', async () => {
    let now = 0;
    const sent: unknown[] = [];
    const tracker = new GlitchBehaviorTracker({
      build: '0.20.5',
      now: () => now,
      sendEvent: async (event) => {
        sent.push(event);
      },
    });
    const liveWorld = world();

    tracker.observeWorld(liveWorld);
    tracker.trackFirstInput('keyboard', liveWorld);
    tracker.trackFirstInput('mouse', liveWorld);
    tracker.observeSimEvents(
      [
        { type: 'xp', amount: 12 },
        { type: 'xp', amount: 8 },
        { type: 'questAccepted', questId: 'q_wolves' },
      ],
      liveWorld,
    );
    now = 3000;
    (liveWorld.player as unknown as { level: number }).level = 6;
    (liveWorld.player.pos as unknown as { z: number }).z = 300;
    tracker.observeWorld(liveWorld);

    await Promise.resolve();
    expect(sent).toMatchObject([
      { step_key: 'zone_eastbrook_vale', action_key: 'enter' },
      { step_key: 'level_01', action_key: 'reach' },
      { step_key: 'input', action_key: 'first_intent', metadata: { input_kind: 'keyboard' } },
      { step_key: 'progression', action_key: 'xp_gain', metadata: { amount: 12 } },
      { step_key: 'quest', action_key: 'accept', metadata: { quest_id: 'q_wolves' } },
      { step_key: 'quest_q_wolves_accept', action_key: 'reach' },
      { step_key: 'zone_mirefen_marsh', action_key: 'enter' },
      { step_key: 'level_06', action_key: 'reach' },
    ]);
  });
});
