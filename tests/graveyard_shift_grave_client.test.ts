// The Graveyard Shift grave on the client: its body and soft glow, no loot
// glint, its own label, the once-per-session whisper, Tibbs' rig, and the
// offer the quest-event router opens.
import { describe, expect, it, vi } from 'vitest';
import { visualKeyFor } from '../src/render/characters/manifest';
import { objectDisplayName } from '../src/render/entity_labels';
import {
  freshGraveWhisperState,
  GRAVE_WHISPER_COOLDOWN_MS,
  GRAVE_WHISPER_REARM_RADIUS,
  graveWhisperDue,
} from '../src/render/grave_whisper_core';
import { lootGlint } from '../src/render/ground_object_glint_core';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { updateWorldSpeech } from '../src/render/world_speech';
import {
  GRAVE_ENTITY_ID,
  GRAVE_INTERACT_RADIUS,
  GRAVE_ITEM_ID,
  GRAVE_POS,
  GRAVE_WHISPER_RADIUS,
  TIBBS_NPC_ID,
} from '../src/sim/graveyard_shift/grave_entry';
import { TIBBS_LINES } from '../src/sim/graveyard_shift/grave_staging';
import type { Entity, SimEvent } from '../src/sim/types';
import { applyQuestEventPresentation } from '../src/ui/hud/quest/quest_event_router';
import { tibbsDeclineLine, tibbsOfferDialog } from '../src/ui/hud/quest/tibbs_offer_view';
import { setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

// Each caller's Tibbs takes a fresh id; any id stands in for one here.
const TIBBS_ENTITY_ID = 900_001;

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
    expect(objectDisplayName(grave)).toBe('Glowing Grave');
  });
});

describe('the grave whisper', () => {
  const at = (d: number) => ({ x: GRAVE_POS.x + d, z: GRAVE_POS.z });

  it('fires within its radius, never beyond, never without the grave', () => {
    expect(graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_RADIUS), freshGraveWhisperState(), 0)).toBe(
      true,
    );
    expect(
      graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_RADIUS + 0.5), freshGraveWhisperState(), 0),
    ).toBe(false);
    expect(graveWhisperDue(null, at(1), freshGraveWhisperState(), 0)).toBe(false);
  });

  it('whispers again on each return past the re-arm radius, never inside the cooldown', () => {
    expect(GRAVE_WHISPER_RADIUS).toBe(6);
    expect(GRAVE_WHISPER_RADIUS).toBe(GRAVE_INTERACT_RADIUS);
    expect(GRAVE_WHISPER_REARM_RADIUS).toBe(12);
    expect(GRAVE_WHISPER_COOLDOWN_MS).toBe(30_000);
    const state = freshGraveWhisperState();
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 0)).toBe(true);
    // Lingering, or stepping out short of the re-arm radius, says nothing more.
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 60_000)).toBe(false);
    expect(graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_REARM_RADIUS - 1), state, 61_000)).toBe(
      false,
    );
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 62_000)).toBe(false);
    // Walk off and come back: a fresh whisper.
    expect(graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_REARM_RADIUS + 1), state, 63_000)).toBe(
      false,
    );
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 64_000)).toBe(true);
    // Back again within the cooldown: held until it runs out, then said once.
    graveWhisperDue(GRAVE_POS, at(GRAVE_WHISPER_REARM_RADIUS + 1), state, 70_000);
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 80_000)).toBe(false);
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 94_000)).toBe(true);
    expect(graveWhisperDue(GRAVE_POS, at(3), state, 200_000)).toBe(false);
  });

  it('shows one bubble over the grave per approach, in the player language', () => {
    setLanguage('en');
    const host = { showChatBubble: vi.fn() };
    const player = { pos: { x: GRAVE_POS.x + 30, y: 0, z: GRAVE_POS.z } };
    const world = {
      worldQuestLog: new Map(),
      entities: new Map([[GRAVE_ENTITY_ID, grave]]),
      player,
    } as unknown as Pick<IWorld, 'worldQuestLog' | 'entities' | 'player'>;
    updateWorldSpeech(world, host, 0);
    expect(host.showChatBubble).not.toHaveBeenCalled();
    player.pos.x = GRAVE_POS.x + 3;
    updateWorldSpeech(world, host, 1_000);
    updateWorldSpeech(world, host, 2_000);
    expect(host.showChatBubble).toHaveBeenCalledTimes(1);
    expect(host.showChatBubble.mock.calls[0][0]).toBe(GRAVE_ENTITY_ID);
    expect(host.showChatBubble.mock.calls[0][1]).toBe('Psst. Down here.');
    // Missed it: walk off and come back for another.
    player.pos.x = GRAVE_POS.x + 30;
    updateWorldSpeech(world, host, 40_000);
    player.pos.x = GRAVE_POS.x + 3;
    updateWorldSpeech(world, host, 41_000);
    expect(host.showChatBubble).toHaveBeenCalledTimes(2);
    // A new renderer session keeps its own state.
    const next = { showChatBubble: vi.fn() };
    updateWorldSpeech(world, next, 41_500);
    expect(next.showChatBubble).toHaveBeenCalledTimes(1);
  });
});

describe("Tibbs' keyed lines", () => {
  it('emit the catalog English as their fallback text, key for key', () => {
    setLanguage('en');
    const lines = Object.entries(TIBBS_LINES);
    expect(lines.length).toBeGreaterThan(0);
    for (const [line, text] of lines) {
      expect(t(`graveyardShift.tibbs.say.${line}` as TranslationKey)).toBe(text);
    }
  });
});

describe('Tibbs', () => {
  it('stands on the skeleton minion rig', () => {
    expect(
      visualKeyFor({ id: TIBBS_ENTITY_ID, kind: 'npc', templateId: TIBBS_NPC_ID } as Entity),
    ).toBe('skel_minion');
  });

  it('pitches the shift in full every time before the win, as one unquoted speech', () => {
    setLanguage('en');
    const npc = { kind: 'npc', templateId: TIBBS_NPC_ID } as Entity;
    const offer = tibbsOfferDialog(npc, new Set<string>())!;
    expect(offer.lines).toHaveLength(3);
    expect(offer.lines[0]).toMatch(/^Ah, you heard me\. Name's Tibbs\./);
    expect(offer.lines[1]).toMatch(/four thousand eight hundred times this week/);
    expect(offer.lines[2]).toMatch(/They will never notice the difference\. Well\. They will\.$/);
    expect(offer.quoted).toBe(false);
    expect(offer.acceptLabel).toBe('Take the shift');
    expect(offer.declineLabel).toBe('Not today');
    expect(tibbsOfferDialog({ kind: 'npc', templateId: 'x' } as Entity, new Set())).toBeNull();
    expect(tibbsDeclineLine()).toBe('Fair. Nobody reads the job description either.');
  });

  it('offers nothing once the shift is won: one closing line, no accept button', () => {
    setLanguage('en');
    const npc = { kind: 'npc', templateId: TIBBS_NPC_ID } as Entity;
    const offer = tibbsOfferDialog(npc, new Set(['hid_boss_for_a_day']))!;
    expect(offer.lines).toEqual([
      'Your shift is covered. Morthen is back at work, and he says thank you.',
    ]);
    expect(offer.acceptLabel).toBeNull();
    expect(offer.quoted).toBe(true);
    expect(offer.declineLabel).toBe('Continue');
  });

  it("his offer event opens the quest dialog on him and stops the HUD's switch", () => {
    const hud = {
      log: vi.fn(),
      questBanner: { show: vi.fn() },
      showBanner: vi.fn(),
      questDialog: { refresh: vi.fn(), open: vi.fn(), openWhenPresent: vi.fn() },
      worldQuestPuzzleWindow: { applyEventPresentation: vi.fn() },
      treasureMapWindow: { open: vi.fn(), refresh: vi.fn() },
    };
    const ev = {
      type: 'graveyardShiftOffer',
      npcId: TIBBS_ENTITY_ID,
      pid: 1,
    } as SimEvent;
    expect(applyQuestEventPresentation(hud, ev)).toBe(true);
    expect(hud.questDialog.openWhenPresent).toHaveBeenCalledWith(TIBBS_ENTITY_ID, undefined);
    expect(hud.log).not.toHaveBeenCalled();
    // At the end of a grave shift the event carries his report into the dialog.
    const report = { outcome: 'won' as const, sent: 10, saved: 2, copper: 2000 };
    applyQuestEventPresentation(hud, { ...ev, report } as SimEvent);
    expect(hud.questDialog.openWhenPresent).toHaveBeenLastCalledWith(TIBBS_ENTITY_ID, report);
  });
});
