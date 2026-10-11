import { expect, it, vi } from 'vitest';
import { updateForgeSpeech } from '../src/render/forge_speech';
import { FORGE_NPC_ID, FORGE_QUEST_ID } from '../src/sim/content/world_quest_forging';
import { createForgeWorkshop } from '../src/sim/minigames/forge_workshop';
import type { WorldQuestProgress } from '../src/sim/types';

it('keeps owner instructions above Mara until a step changes, then clears cancellation', () => {
  const progress: WorldQuestProgress = {
    questId: FORGE_QUEST_ID,
    state: 'active',
    count: 0,
    forging: createForgeWorkshop(42, 100),
  };
  const world = { worldQuestLog: new Map([[FORGE_QUEST_ID, progress]]) };
  const host = { showChatBubble: vi.fn() };
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenLastCalledWith(
    FORGE_NPC_ID,
    'Ready your hands! Starting in 3s.',
    { offsetY: -32 },
    Infinity,
  );
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenCalledTimes(1);
  const session = progress.forging!;
  Object.assign(session, { phase: 'working', observedAt: 103 });
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenLastCalledWith(
    FORGE_NPC_ID,
    'Watch the needle. Strike inside the dark band!',
    { offsetY: -32 },
    Infinity,
  );
  // The clock alone (with the forge kept warm) never re-issues the same coaching line.
  session.observedAt = 1000;
  session.heatAt = 1000;
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenCalledTimes(2);
  const spectator = { showChatBubble: vi.fn() };
  updateForgeSpeech({ worldQuestLog: new Map() }, spectator);
  expect(spectator.showChatBubble).not.toHaveBeenCalled();
  delete progress.forging;
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenLastCalledWith(FORGE_NPC_ID, '', false, 0);
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenCalledTimes(3);
});

it('announces completion briefly and replaces it when practice starts again', () => {
  const progress: WorldQuestProgress = {
    questId: FORGE_QUEST_ID,
    state: 'completed',
    count: 1,
    forging: createForgeWorkshop(42, 100),
  };
  progress.forging!.phase = 'success';
  const world = { worldQuestLog: new Map([[FORGE_QUEST_ID, progress]]) };
  const host = { showChatBubble: vi.fn() };
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenLastCalledWith(
    FORGE_NPC_ID,
    'Fine work! A shield fit for the garrison!',
    { offsetY: -32 },
    5,
  );
  updateForgeSpeech(world, host);
  expect(host.showChatBubble).toHaveBeenCalledTimes(1);
  progress.forging = createForgeWorkshop(50, 200);
  updateForgeSpeech(world, host);
  expect(host.showChatBubble.mock.lastCall?.[3]).toBe(Infinity);
  world.worldQuestLog.clear();
  updateForgeSpeech(world, host);
  expect(host.showChatBubble.mock.lastCall?.[3]).toBe(0);
});
