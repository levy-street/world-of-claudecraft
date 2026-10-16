// The client half of the dungeon lore guides: the gossip dialog's view (which
// greeting, whether the answer rows show) off the mirrored guideState, the
// id-only line event rendered as a localized `say` bubble and chat line (an
// action line as one emote-coloured chat line), every key the guide record
// names present in the catalog with the record's own English, and the
// router's weld to the private Hud members it drives.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CANTOR_DIALOG_TEXT,
  CANTOR_GUIDE,
  CANTOR_NPC_ID,
} from '../src/sim/content/drowned_temple_cantor';
import { dungeonGuideKey } from '../src/sim/content/dungeon_guides';
import type { SimEvent } from '../src/sim/types';
import { applyDungeonGuideSpeech } from '../src/ui/hud/dungeon/dungeon_guide_speech';
import { guideLineView } from '../src/ui/hud/dungeon/dungeon_guide_speech_view';
import { guideDialogView } from '../src/ui/hud/quest/dungeon_guide_dialog_core';
import { ensureLocaleLoaded, setLanguage, type TranslationKey, t } from '../src/ui/i18n';

const npc = (id: number, guideState?: 'open' | 'declined' | 'joined' | 'closed' | 'singing') => ({
  id,
  templateId: CANTOR_NPC_ID,
  guideState,
});

describe('the guide dialog view', () => {
  it('offers the two rows while the offer stands, refused or not', () => {
    for (const state of ['open', 'declined', undefined] as const) {
      const view = guideDialogView(npc(10, state));
      expect(view?.rows).toEqual({
        joinKey: 'dungeonGuide.drownedTemple.row.join',
        declineKey: 'dungeonGuide.drownedTemple.row.decline',
      });
      expect(view?.textKey).toBe('dungeonGuide.drownedTemple.greet.1');
    }
    expect(guideDialogView(npc(11, 'open'))?.textKey).toBe('dungeonGuide.drownedTemple.greet.2');
  });

  it('drops the rows once he walks with the group, sings, or the offer lapsed', () => {
    expect(guideDialogView(npc(10, 'joined'))).toEqual({
      textKey: 'dungeonGuide.drownedTemple.joined',
      rows: null,
      state: 'joined',
    });
    expect(guideDialogView(npc(10, 'singing'))?.textKey).toBe('dungeonGuide.drownedTemple.singing');
    expect(guideDialogView(npc(10, 'singing'))?.rows).toBeNull();
    const closed = guideDialogView(npc(10, 'closed'));
    expect(closed?.rows).toBeNull();
    expect(closed?.textKey).toBe('dungeonGuide.drownedTemple.greet.1');
  });

  it('is null for every other NPC', () => {
    expect(
      guideDialogView({ id: 3, templateId: 'tidewatcher_ondrel', guideState: undefined }),
    ).toBe(null);
  });
});

describe('the guide catalog', () => {
  it('holds every line and dialog key with the record English', () => {
    setLanguage('en');
    for (const line of CANTOR_GUIDE.lines) {
      const key = dungeonGuideKey(CANTOR_GUIDE, line.key) as TranslationKey;
      expect(t(key, { name: 'Laverock' }), line.id).toBe(line.text.replace('{name}', 'Laverock'));
    }
    for (const [k, text] of Object.entries(CANTOR_DIALOG_TEXT)) {
      expect(t(dungeonGuideKey(CANTOR_GUIDE, k) as TranslationKey)).toBe(text);
    }
    expect(t('abilityUi.cast.cantor_last_verse')).toBe('The Last Verse');
  });
});

describe('a guide line on the HUD', () => {
  const lineEv = (lineId: string) =>
    ({ type: 'dungeonGuideLine', guideId: CANTOR_GUIDE.id, lineId, npcId: 77, pid: 1 }) as SimEvent;

  function fakeHud() {
    return {
      log: vi.fn(),
      chatLogFrom: vi.fn(),
      renderer: { showChatBubble: vi.fn() },
    };
  }

  it('speaks a line as a quiet say bubble over him and a say chat line', () => {
    setLanguage('en');
    const hud = fakeHud();
    expect(applyDungeonGuideSpeech(hud, lineEv('C04'))).toBe(true);
    const text = 'We drank the moon-water from shells like those. Mine I dropped on the stair.';
    // A plain say line, never the player-chat sender button (no whisper menu).
    expect(hud.log).toHaveBeenCalledWith(
      `Laverock says: ${text}`,
      expect.any(String),
      undefined,
      'say',
    );
    expect(hud.chatLogFrom).not.toHaveBeenCalled();
    expect(hud.renderer.showChatBubble).toHaveBeenCalledWith(77, text, expect.anything());
    const style = hud.renderer.showChatBubble.mock.calls[0][2];
    expect(style?.yell).not.toBe(true);
  });

  it('prints an action line once, with his name and no bubble', () => {
    setLanguage('en');
    const hud = fakeHud();
    expect(applyDungeonGuideSpeech(hud, lineEv('F06'))).toBe(true);
    expect(hud.log.mock.calls[0][0]).toBe(
      'Laverock lifts his voice over the altar, and the lagoon falls still.',
    );
    expect(hud.log.mock.calls[0][3]).toBe('emote');
    expect(hud.renderer.showChatBubble).not.toHaveBeenCalled();
  });

  it('drops an unknown line (version skew) and leaves other events alone', () => {
    const hud = fakeHud();
    expect(applyDungeonGuideSpeech(hud, lineEv('Z99'))).toBe(true);
    expect(guideLineView(lineEv('Z99'))).toBeNull();
    expect(hud.log).not.toHaveBeenCalled();
    expect(applyDungeonGuideSpeech(hud, { type: 'levelup', level: 2 } as SimEvent)).toBe(false);
  });

  it('localizes the line in the reader language', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const view = guideLineView(lineEv('C04'));
    expect(view?.text).not.toContain('moon-water');
    setLanguage('en');
  });

  it('stays welded to the private Hud members it drives', () => {
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const anchor of [
      '    decorativeIconUrl?: string,\n    channel = ERROR_LOG_CHAN,',
      '    private renderer: Renderer,',
      '  log(\n    // A string body',
      'if (applyDungeonGuideSpeech(this, ev)) continue;',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toContain('  showChatBubble(\n    entityId: number,\n    text: string,');
  });
});
