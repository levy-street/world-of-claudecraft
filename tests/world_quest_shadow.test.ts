import { describe, expect, it } from 'vitest';
import { shadowChooseSlot } from '../src/game/shadow_controls';
import {
  SHADOW_QUEST_ID as ID,
  SHADOW_GUARDS,
  SHADOW_NPC_DEF,
  SHADOW_NPC_ID,
  SHADOW_SAFE_SPOT,
  SHADOW_WIDE_CIRCLE_FILL_SECONDS,
} from '../src/sim/content/world_quest_shadow';
import { BUILTIN_WORLD } from '../src/sim/data';
import { hasShadowCloak, shadowActionsLocked } from '../src/sim/shadow_action_lock';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';
import { t } from '../src/ui/i18n';
import { createShadowActionBarView, shadowActionHint } from '../src/ui/world_quest_shadow_view';

function setup() {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      groundObjects: [],
      npcs: Object.fromEntries(
        [SHADOW_NPC_DEF, ...SHADOW_GUARDS.map((row) => row.npc)].map((npc) => [npc.id, npc]),
      ),
    },
  });
  sim.resetDay = '2026-09-06';
  sim.chat('/dev shadow');
  sim.talkToNpc(SHADOW_NPC_ID);
  return sim;
}
function tick(sim: Sim, n = 22) {
  for (let i = 0; i < n; i++) sim.tick();
}
function safeGuards(sim: Sim) {
  for (const row of SHADOW_GUARDS.filter((guard) => guard.sentry))
    sim.entities.get(row.entityId)!.dead = true;
}
function near(sim: Sim, id: number, offset = 2) {
  const guard = sim.entities.get(id)!;
  sim.player.pos = sim.groundPos(
    guard.pos.x - Math.sin(guard.facing) * offset,
    guard.pos.z - Math.cos(guard.facing) * offset,
  );
  sim.player.prevPos = { ...sim.player.pos };
}
describe('Duskweave dispatches world quest', () => {
  it('steals four distinct dispatches with real commands and awards once, restoring actions', () => {
    const sim = setup();
    safeGuards(sim);
    const before = sim.xp;
    expect(hasShadowCloak(sim.player)).toBe(true);
    for (const guard of SHADOW_GUARDS.filter((row) => !row.sentry)) {
      near(sim, guard.entityId);
      sim.shadowWorldQuestAction('pickpocket', guard.entityId);
      tick(sim, 40);
    }
    expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
    expect(sim.xp).toBeGreaterThan(before);
    expect(hasShadowCloak(sim.player)).toBe(false);
    expect(shadowActionsLocked(sim.worldQuestLog)).toBe(false);
    const earned = sim.xp;
    const meta = sim.meta(sim.playerId)!;
    const rewards = {
      copper: meta.copper,
      factions: { ...meta.factions },
      counters: { ...meta.counters },
    };
    sim.player.pos = sim.groundPos(SHADOW_NPC_DEF.pos.x, SHADOW_NPC_DEF.pos.z);
    sim.talkToNpc(SHADOW_NPC_ID);
    expect(hasShadowCloak(sim.player)).toBe(true);
    expect(sim.worldQuestLog.get(ID)?.practiceOnly).toBe(true);
    const saved = sim.serializeCharacter(sim.playerId)!;
    expect(saved.worldQuests?.progress.find((row) => row.questId === ID)).toMatchObject({
      state: 'completed',
      count: 4,
    });
    expect(saved.worldQuests?.progress.find((row) => row.questId === ID)).not.toHaveProperty(
      'practiceOnly',
    );
    for (const guard of SHADOW_GUARDS.filter((row) => !row.sentry)) {
      near(sim, guard.entityId);
      sim.shadowWorldQuestAction('pickpocket', guard.entityId);
      tick(sim, 40);
    }
    expect(sim.worldQuestLog.get(ID)?.state).toBe('completed');
    expect(hasShadowCloak(sim.player)).toBe(false);
    expect(sim.xp).toBe(earned);
    expect(meta.copper).toBe(rewards.copper);
    expect(meta.factions).toEqual(rewards.factions);
    expect(meta.counters.questsCompleted).toBe(rewards.counters.questsCompleted);
  });
  it('catches contact, preserves stolen dispatches, and permits another cloak without duplicate credit', () => {
    const sim = setup();
    safeGuards(sim);
    near(sim, 2146900041);
    sim.shadowWorldQuestAction('pickpocket', 2146900041);
    tick(sim, 40);
    near(sim, 2146900042, 0);
    // A carrier's contact circle fills suspicion slowly (SHADOW_CONTACT_FILL_SECONDS):
    // a brush is survivable, standing on him is not.
    tick(sim, 14);
    expect(sim.worldQuestLog.get(ID)?.shadow?.phase).toBe('cloaked');
    tick(sim, 20);
    expect(sim.worldQuestLog.get(ID)?.shadow?.phase).toBe('caught');
    expect(hasShadowCloak(sim.player)).toBe(false);
    sim.talkToNpc(SHADOW_NPC_ID);
    expect(hasShadowCloak(sim.player)).toBe(true);
    near(sim, 2146900041);
    sim.shadowWorldQuestAction('pickpocket', 2146900041);
    tick(sim);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(1);
  });
  it('lets a thief lift a wide-circle dispatch and leave, but not loiter inside the circle', () => {
    const sim = setup();
    safeGuards(sim);
    // The east carrier's circle is wide: standing beside him is inside it.
    near(sim, 2146900043, 2);
    sim.shadowWorldQuestAction('pickpocket', 2146900043);
    tick(sim);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(1);
    expect(sim.worldQuestLog.get(ID)?.shadow?.phase).toBe('cloaked');
    // Loitering fills the slow circle all the way.
    tick(sim, Math.ceil(SHADOW_WIDE_CIRCLE_FILL_SECONDS * 20));
    expect(sim.worldQuestLog.get(ID)?.shadow?.phase).toBe('caught');
  });
  it('walks into both wide circles and completes from 2/4 through the real action controls', () => {
    function run() {
      const sim = setup();
      // Isolate carrier suspicion from lantern timing; keep real movement,
      // authoritative suspicion, client controls and the full steal channel.
      safeGuards(sim);
      const progress = sim.worldQuestLog.get(ID)!;
      progress.count = 2;
      progress.creditedObjects = ['2146900041', '2146900042'];
      const view = createShadowActionBarView();
      const trace: number[] = [];
      for (const id of [2146900043, 2146900044]) {
        const guard = sim.entities.get(id)!;
        near(sim, id, 5.8);
        sim.player.facing = guard.facing;
        sim.player.targetId = id;
        sim.moveInput.forward = true;
        for (let i = 0; i < 40; i++) {
          if (Math.hypot(sim.player.pos.x - guard.pos.x, sim.player.pos.z - guard.pos.z) <= 2.3)
            break;
          sim.tick();
        }
        sim.moveInput.forward = false;
        expect(
          Math.hypot(sim.player.pos.x - guard.pos.x, sim.player.pos.z - guard.pos.z),
        ).toBeLessThanOrEqual(2.5);
        expect(progress.shadow?.suspicion).toBeGreaterThan(0);
        expect(progress.shadow?.suspicion).toBeLessThan(0.5);
        trace.push(progress.shadow!.suspicion);
        expect(view.tick(sim, () => '').slots[0].usable).toBe(true);
        expect(shadowActionHint(sim)).toBe(t('questUi.worldQuest.shadow.stealTip'));
        shadowChooseSlot(sim, 0);
        expect(progress.shadow?.stealing?.targetId).toBe(id);
        tick(sim);
        trace.push(progress.count);
        if (progress.state === 'active') {
          expect(progress.count).toBe(3);
          expect(progress.creditedObjects).toEqual(['2146900041', '2146900042', '2146900043']);
          sim.player.pos = sim.groundPos(SHADOW_SAFE_SPOT.x, SHADOW_SAFE_SPOT.z);
          sim.player.prevPos = { ...sim.player.pos };
          tick(sim, 20);
        }
      }
      expect(progress.state).toBe('completed');
      expect(progress.count).toBe(4);
      expect(progress.creditedObjects).toBeUndefined();
      expect(hasShadowCloak(sim.player)).toBe(false);
      return trace;
    }
    expect(run()).toEqual(run());
  });
  it.each([
    [0, true],
    [0.2, true],
    [0.499, true],
    [0.5, false],
    [0.9, false],
  ] as const)('keeps authoritative steal admission at suspicion %s', (suspicion, allowed) => {
    const sim = setup();
    safeGuards(sim);
    near(sim, 2146900043);
    tick(sim, 1);
    sim.worldQuestLog.get(ID)!.shadow!.suspicion = suspicion;
    sim.shadowWorldQuestAction('pickpocket', 2146900043);
    expect(sim.worldQuestLog.get(ID)?.shadow?.stealing !== undefined).toBe(allowed);
  });
  it('keeps HUD, controls and authority blocked in a lantern beam below the suspicion limit', () => {
    const sim = setup();
    safeGuards(sim);
    near(sim, 2146900043);
    tick(sim, 1);
    const shadow = sim.worldQuestLog.get(ID)!.shadow!;
    shadow.suspicion = 0.2;
    const lantern = sim.entities.get(2146900045)!;
    lantern.dead = false;
    lantern.pos = { ...sim.player.pos, x: sim.player.pos.x - 4 };
    lantern.facing = Math.PI / 2;
    sim.player.targetId = 2146900043;
    const view = createShadowActionBarView();
    expect(view.tick(sim, () => '').slots[0].usable).toBe(false);
    expect(view.tick(sim, () => '').slots[1].usable).toBe(true);
    shadowChooseSlot(sim, 0);
    expect(shadow.stealing).toBeUndefined();
    sim.shadowWorldQuestAction('pickpocket', 2146900043);
    expect(shadow.stealing).toBeUndefined();

    lantern.facing = -Math.PI / 2;
    expect(view.tick(sim, () => '').slots[0].usable).toBe(true);
    shadowChooseSlot(sim, 0);
    expect(shadow.stealing?.targetId).toBe(2146900043);
  });
  it('rejects remote and sentry targets, cancels a moving steal, and ignores command spam', () => {
    const sim = setup();
    safeGuards(sim);
    sim.shadowWorldQuestAction('pickpocket', 2146900041);
    expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeUndefined();
    near(sim, 2146900041);
    sim.shadowWorldQuestAction('pickpocket', 2146900041);
    for (let i = 0; i < 50; i++) sim.shadowWorldQuestAction('pickpocket', 2146900041);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
    sim.player.pos.x += 0.5;
    tick(sim);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
    sim.shadowWorldQuestAction('pickpocket', 2146900045);
    expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeUndefined();
  });
  it.each(['leave', 'death', 'departure', 'rotation'] as const)(
    'restores normal action authority on %s',
    (reason) => {
      const sim = setup();
      expect(shadowActionsLocked(sim.worldQuestLog)).toBe(true);
      sim.castAbility('battle_shout');
      expect(sim.player.auras.some((a) => a.id === 'battle_shout')).toBe(false);
      if (reason === 'leave') sim.shadowWorldQuestAction('leave');
      if (reason === 'death') sim.player.dead = true;
      if (reason === 'departure') sim.player.pos.x = 200;
      if (reason === 'rotation') sim.meta(sim.playerId)!.devWorldQuestCycle = 'wq3_0';
      tick(sim, 1);
      expect(hasShadowCloak(sim.player)).toBe(false);
      expect(shadowActionsLocked(sim.worldQuestLog)).toBe(false);
    },
  );
  it('detects a cloaked player inside a moving sentry circle and allows retreat during warning', () => {
    const sim = setup();
    const sentry = sim.entities.get(2146900045)!;
    sim.player.pos = sim.groundPos(sentry.pos.x, sentry.pos.z);
    tick(sim, 4);
    expect(sim.worldQuestLog.get(ID)?.shadow?.suspicion).toBeGreaterThan(0);
    sim.player.pos = sim.groundPos(SHADOW_SAFE_SPOT.x, SHADOW_SAFE_SPOT.z);
    tick(sim, 10);
    expect(sim.worldQuestLog.get(ID)?.shadow?.suspicion).toBe(0);
    expect(hasShadowCloak(sim.player)).toBe(true);
    sim.player.pos = sim.groundPos(sentry.pos.x, sentry.pos.z);
    tick(sim, 14);
    expect(sim.worldQuestLog.get(ID)?.shadow?.phase).toBe('caught');
  });
  it('keeps each player progress independent while sharing the guards', () => {
    const sim = setup();
    safeGuards(sim);
    const pid = sim.addPlayer('warrior', 'Second');
    sim.chat('/dev shadow', pid);
    sim.talkToNpc(SHADOW_NPC_ID, pid);
    const second = sim.entities.get(pid)!;
    near(sim, 2146900041);
    second.pos = { ...sim.player.pos };
    sim.shadowWorldQuestAction('pickpocket', 2146900041);
    sim.shadowWorldQuestAction('pickpocket', 2146900041, pid);
    tick(sim, 30);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(1);
    expect(sim.meta(pid)?.worldQuestLog.get(ID)?.count).toBe(1);
    sim.shadowWorldQuestAction('leave');
    expect(hasShadowCloak(second)).toBe(true);
    expect(hasShadowCloak(sim.player)).toBe(false);
  });
  it('rejects a forged guard template and vertical instructor proximity', () => {
    const sim = setup();
    safeGuards(sim);
    near(sim, 2146900041);
    const guard = sim.entities.get(2146900041)!;
    guard.templateId = 'fake_guard';
    sim.shadowWorldQuestAction('pickpocket', guard.id);
    tick(sim);
    expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
    sim.shadowWorldQuestAction('leave');
    near(sim, SHADOW_NPC_ID);
    sim.player.pos.y += 30;
    sim.talkToNpc(SHADOW_NPC_ID);
    expect(hasShadowCloak(sim.player)).toBe(false);
  });

  it('blocks class casts only during the cloak and preserves another stealth aura on leaving', () => {
    const sim = setup();
    sim.player.resource = 100;
    sim.castAbility('battle_shout');
    expect(sim.player.auras.some((a) => a.id === 'battle_shout')).toBe(false);
    sim.player.auras.push({
      id: 'other_stealth',
      name: 'Stealth',
      kind: 'stealth',
      value: 0.7,
      remaining: 60,
      duration: 60,
      sourceId: sim.playerId,
      school: 'physical',
    });
    sim.shadowWorldQuestAction('leave');
    expect(sim.player.auras.some((a) => a.id === 'other_stealth')).toBe(true);
    expect(sim.player.stealthed).toBe(true);
    sim.castAbility('battle_shout');
    expect(sim.player.auras.some((a) => a.id === 'battle_shout')).toBe(true);
  });
});

it('refuses front theft and cancels a channel if the player moves in front', () => {
  const sim = setup();
  safeGuards(sim);
  const guard = sim.entities.get(2146900041)!;
  sim.player.pos = sim.groundPos(
    guard.pos.x + Math.sin(guard.facing) * 2,
    guard.pos.z + Math.cos(guard.facing) * 2,
  );
  sim.shadowWorldQuestAction('pickpocket', guard.id);
  expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeUndefined();
  sim.player.pos = sim.groundPos(
    guard.pos.x - Math.sin(guard.facing) * 2,
    guard.pos.z - Math.cos(guard.facing) * 2,
  );
  sim.shadowWorldQuestAction('pickpocket', guard.id);
  expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeDefined();
  sim.player.pos = sim.groundPos(
    guard.pos.x + Math.sin(guard.facing) * 2,
    guard.pos.z + Math.cos(guard.facing) * 2,
  );
  tick(sim, 1);
  expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeUndefined();
  expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
});

it('revalidates the rear pocket throughout a stationary channel', () => {
  const sim = setup();
  safeGuards(sim);
  near(sim, 2146900041);
  const guard = sim.entities.get(2146900041);
  if (!guard) throw new Error('missing carrier');
  sim.shadowWorldQuestAction('pickpocket', guard.id);
  expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeDefined();
  guard.facing += Math.PI;
  tick(sim, 1);
  expect(sim.worldQuestLog.get(ID)?.shadow?.stealing).toBeUndefined();
  expect(sim.worldQuestLog.get(ID)?.count).toBe(0);
});
