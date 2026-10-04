// The Graveyard Shift grave on the client: its body and soft glow, no loot
// glint, its own label, the once-per-session whisper, Tibbs' rig, and the
// offer the quest-event router opens.
import { describe, expect, it, vi } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { objectDisplayName } from '../src/render/entity_labels';
import { graveWhisperDue } from '../src/render/grave_whisper_core';
import { lootGlint } from '../src/render/ground_object_glint_core';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { updateWorldSpeech } from '../src/render/world_speech';
import {
  GRAVE_ENTITY_ID,
  GRAVE_ITEM_ID,
  GRAVE_POS,
  GRAVE_WHISPER_RADIUS,
  TIBBS_ENTITY_ID,
  TIBBS_NPC_ID,
} from '../src/sim/graveyard_shift/grave_entry';
import type { Entity, SimEvent } from '../src/sim/types';
import { applyQuestEventPresentation } from '../src/ui/hud/quest/quest_event_router';
import { tibbsDeclineLine, tibbsOfferDialog } from '../src/ui/hud/quest/tibbs_offer_view';
import { setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

vi.mock('../src/game/sfx', () => ({ sfx: { playUi: vi.fn() } }));

const grave = {
  id: GRAVE_ENTITY_ID,
  kind: 'object',
  templateId: `ground_${GRAVE_ITEM_ID}`,
  objectItemId: GRAVE_ITEM_ID,
  name: 'Grave',
  pos: { x: GRAVE_POS.x, y: 0, z: GRAVE_POS.z },
} as unknown as Entity;

describe('the grave body', () => {
  it('stands on the shipped gravestone model and wears no loot glint', () => {
    expect(questObjectPreloadInternalsForTest.questObjectUrl[GRAVE_ITEM_ID]).toBe(
      '/models/dungeon/gravestone.glb',
    );
    expect(lootGlint(GRAVE_ITEM_ID)).toBe(false);
    expect(lootGlint('forge_fuel')).toBe(false);
    expect(lootGlint('supply_crate')).toBe(true);
    expect(lootGlint(null)).toBe(true);
  });

  it('reads its own name', () => {
    setLanguage('en');
    expect(objectDisplayName(grave)).toBe('Weathered Grave');
  });
});

describe('the grave whisper', () => {
  it('fires within its radius, never beyond, never twice, never without the grave', () => {
    const at = (d: number) => ({ x: GRAVE_POS.x + d, z: GRAVE_POS.z });
    expect(graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_RADIUS), false)).toBe(true);
    expect(graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_RADIUS + 0.5), false)).toBe(false);
    expect(graveWhisperDue(GRAVE_POS, at(1), true)).toBe(false);
    expect(graveWhisperDue(null, at(1), false)).toBe(false);
  });

  it('shows one bubble over the grave per session, in the player language', () => {
    setLanguage('en');
    const host = { showChatBubble: vi.fn() };
    const player = { pos: { x: GRAVE_POS.x + 30, y: 0, z: GRAVE_POS.z } };
    const world = {
      worldQuestLog: new Map(),
      entities: new Map([[GRAVE_ENTITY_ID, grave]]),
      player,
    } as unknown as Pick<IWorld, 'worldQuestLog' | 'entities' | 'player'>;
    updateWorldSpeech(world, host);
    expect(host.showChatBubble).not.toHaveBeenCalled();
    player.pos.x = GRAVE_POS.x + 3;
    updateWorldSpeech(world, host);
    updateWorldSpeech(world, host);
    expect(host.showChatBubble).toHaveBeenCalledTimes(1);
    expect(host.showChatBubble.mock.calls[0][0]).toBe(GRAVE_ENTITY_ID);
    expect(host.showChatBubble.mock.calls[0][1]).toBe('Psst. Down here.');
    // A new renderer session whispers again.
    const next = { showChatBubble: vi.fn() };
    updateWorldSpeech(world, next);
    expect(next.showChatBubble).toHaveBeenCalledTimes(1);
  });
});

describe('Tibbs', () => {
  it('stands on the skeleton minion rig', () => {
    expect(
      visualKeyFor({ id: TIBBS_ENTITY_ID, kind: 'npc', templateId: TIBBS_NPC_ID } as Entity),
    ).toBe('skel_minion');
  });

  it('pitches the shift in full every time (it can be won once)', () => {
    setLanguage('en');
    const npc = { kind: 'npc', templateId: TIBBS_NPC_ID } as Entity;
    const offer = tibbsOfferDialog(npc)!;
    expect(offer.lines).toHaveLength(4);
    expect(offer.lines[0]).toMatch(/^Ah\. You heard me\. Tibbs\./);
    expect(offer.lines[3]).toMatch(/^Simple job\./);
    expect(offer.acceptLabel).toBe('Take the shift');
    expect(offer.declineLabel).toBe('Not today');
    expect(tibbsOfferDialog({ kind: 'npc', templateId: 'x' } as Entity)).toBeNull();
    expect(tibbsDeclineLine()).toBe('Fair. Nobody reads the job description either.');
  });

  it("his offer event opens the quest dialog on him and stops the HUD's switch", () => {
    const hud = {
      log: vi.fn(),
      questBanner: { show: vi.fn() },
      showBanner: vi.fn(),
      questDialog: { refresh: vi.fn(), open: vi.fn() },
      worldQuestPuzzleWindow: { applyEventPresentation: vi.fn() },
      treasureMapWindow: { open: vi.fn(), refresh: vi.fn() },
    };
    const ev = {
      type: 'graveyardShiftOffer',
      npcId: TIBBS_ENTITY_ID,
      pid: 1,
    } as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(true);
    expect(hud.questDialog.open).toHaveBeenCalledWith(TIBBS_ENTITY_ID);
    expect(hud.log).not.toHaveBeenCalled();
  });
});
