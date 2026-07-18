import { describe, expect, it } from 'vitest';
import {
  behaviorEventBody,
  behaviorEventInputsFromSimEvent,
  chatBehaviorEventInputs,
  deathBehaviorEventInputs,
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

function worldWith(
  entities: Record<number, { kind: string; templateId: string; level: number }>,
  playerOverrides: Record<string, unknown> = {},
): IWorld {
  const map = new Map<number, unknown>();
  for (const [id, e] of Object.entries(entities)) map.set(Number(id), e);
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
      ...playerOverrides,
    },
    entities: map,
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
      { type: 'deedUnlocked', deedId: 'cmb_first_blood', pid: 1 },
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
        stepKey: 'deeds',
        actionKey: 'unlock',
        metadata: { deed_id: 'cmb_first_blood', retro: false },
      },
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

  it('records only the local player kills, tagged by victim kind, without player names', () => {
    const w = worldWith({
      2: { kind: 'mob', templateId: 'timber_wolf', level: 3 },
      3: { kind: 'player', templateId: 'rogue', level: 10 },
    });
    // Player lands the killing blow on a mob.
    expect(behaviorEventInputsFromSimEvent({ type: 'death', entityId: 2, killerId: 1 }, w)).toEqual(
      [
        {
          stepKey: 'combat',
          actionKey: 'enemy_slain',
          metadata: { victim_kind: 'mob', mob_template: 'timber_wolf', victim_level: 3 },
        },
      ],
    );
    // A mob dying to something other than the player is not this player's signal.
    expect(behaviorEventInputsFromSimEvent({ type: 'death', entityId: 2, killerId: 9 }, w)).toEqual(
      [],
    );
    // PvP killing blow records the victim class only, never a name.
    expect(deathBehaviorEventInputs({ type: 'death', entityId: 3, killerId: 1 }, w)).toEqual([
      {
        stepKey: 'combat_pvp',
        actionKey: 'killing_blow',
        metadata: { victim_class: 'rogue', victim_level: 10 },
      },
    ]);
    // The local player dying records what killed them (kind + template, no name).
    expect(deathBehaviorEventInputs({ type: 'death', entityId: 1, killerId: 2 }, w)).toEqual([
      {
        stepKey: 'death',
        actionKey: 'player_dead',
        metadata: { killer_kind: 'mob', killer_template: 'timber_wolf' },
      },
    ]);
  });

  it('maps crafting, delve objectives, incoming chat, and companion barks', () => {
    const w = worldWith({});
    expect(
      behaviorEventInputsFromSimEvent(
        {
          type: 'craftResult',
          ok: true,
          recipeId: 'r_bronze_sword',
          itemId: 'bronze_sword',
          count: 1,
          quality: 'common',
        },
        w,
      ),
    ).toEqual([
      {
        stepKey: 'crafting',
        actionKey: 'craft_success',
        metadata: {
          recipe_id: 'r_bronze_sword',
          item_id: 'bronze_sword',
          count: 1,
          quality: 'common',
          reason: null,
        },
      },
    ]);
    expect(
      behaviorEventInputsFromSimEvent(
        { type: 'delveObjectiveComplete', delveId: 'drowned_litany', tierId: 't1' },
        w,
      ),
    ).toEqual([
      {
        stepKey: 'delve',
        actionKey: 'objective_complete',
        metadata: { delve_id: 'drowned_litany', tier_id: 't1' },
      },
    ]);
    // Incoming chat records the channel only, no text or sender.
    expect(
      chatBehaviorEventInputs(
        { type: 'chat', fromPid: 2, from: 'Someone', text: 'hi there', channel: 'party' },
        w,
      ),
    ).toEqual([{ stepKey: 'chat', actionKey: 'receive', metadata: { channel: 'party' } }]);
    // The player's own outgoing message is not double-counted here.
    expect(
      chatBehaviorEventInputs(
        { type: 'chat', fromPid: 1, from: 'Me', text: 'hello', channel: 'say' },
        w,
      ),
    ).toEqual([]);
    expect(
      behaviorEventInputsFromSimEvent(
        { type: 'companionBark', barkId: 'b_greeting', companionId: 'c_owl' },
        w,
      ),
    ).toEqual([
      {
        stepKey: 'companion_dialogue',
        actionKey: 'bark',
        metadata: { bark_id: 'b_greeting', companion_id: 'c_owl' },
      },
    ]);
  });

  it('emits combat engage/disengage transitions and throttles received chat', async () => {
    let now = 0;
    const sent: Array<{
      step_key: string;
      action_key: string;
      metadata?: Record<string, unknown>;
    }> = [];
    const tracker = new GlitchBehaviorTracker({
      build: '0.22.1',
      now: () => now,
      sendEvent: async (event) => {
        sent.push(event as { step_key: string; action_key: string });
      },
    });
    const liveWorld = world();

    // Baseline observation seeds the combat state without emitting a transition.
    tracker.observeWorld(liveWorld);
    (liveWorld.player as unknown as { inCombat: boolean }).inCombat = true;
    now = 3000;
    tracker.observeWorld(liveWorld);
    (liveWorld.player as unknown as { inCombat: boolean }).inCombat = false;
    now = 6000;
    tracker.observeWorld(liveWorld);

    // Two party messages arrive quickly: only the first is recorded (throttled).
    const chatEvents: SimEvent[] = [
      { type: 'chat', fromPid: 2, from: 'A', text: 'hi', channel: 'party' },
      { type: 'chat', fromPid: 3, from: 'B', text: 'yo', channel: 'party' },
    ];
    tracker.observeSimEvents(chatEvents, liveWorld, now);

    tracker.trackEmote('dance', liveWorld);

    await Promise.resolve();
    const keys = sent.map((e) => `${e.step_key}:${e.action_key}`);
    expect(keys).toContain('combat:engage');
    expect(keys).toContain('combat:disengage');
    expect(keys.filter((k) => k === 'chat:receive')).toHaveLength(1);
    expect(sent).toContainEqual(
      expect.objectContaining({
        step_key: 'emote',
        action_key: 'perform',
        metadata: expect.objectContaining({ emote_id: 'dance' }),
      }),
    );
  });
});
