import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { QUESTS } from '../src/sim/data';
import type { QuestState } from '../src/sim/types';
import {
  GUILD_LETTER_SPOKESMAN_NPC_ID,
  isProfessionMasterNpc,
  PROF_INTRO_HINT_KEY,
  PROF_INTRO_QUEST_ID,
  professionIntroHintVisible,
} from '../src/ui/hud/quest/prof_intro_hint_core';
import { questStrings } from '../src/ui/i18n.catalog/quests';

// The letter-to-Haldren dead-end hint row: a
// profession master's gossip dialog shows one non-interactive line pointing at
// the q_prof_intro giver until the viewer has completed the intro. These arms
// pin the surface (Haldren plus the six station masters), the gating semantics
// (every state except 'done' shows it, including 'active'), and the catalog
// key the row renders.
describe('profession intro hint row', () => {
  it('shows for Smith Haldren before q_prof_intro is completed', () => {
    expect(professionIntroHintVisible(GUILD_LETTER_SPOKESMAN_NPC_ID, 'available', false)).toBe(
      true,
    );
    expect(GUILD_LETTER_SPOKESMAN_NPC_ID).toBe('smith_haldren');
  });

  it('shows for every one of the six station masters pre-completion', () => {
    // The six resident masters (STATIONS masterNpcId): the letter's dead end
    // is Haldren, but the shared dialog builder covers all masters.
    expect(STATIONS.length).toBe(6);
    for (const station of STATIONS) {
      expect(isProfessionMasterNpc(station.masterNpcId), station.masterNpcId).toBe(true);
      expect(
        professionIntroHintVisible(station.masterNpcId, 'available', false),
        station.masterNpcId,
      ).toBe(true);
    }
  });

  it('stays visible while the intro is active or ready (pinned semantics)', () => {
    // Chosen semantics: only completion retires the row; while the intro is
    // merely accepted (active) or awaiting turn-in (ready) it still points
    // home to Foreman Odell, who is both giver and turn-in.
    expect(professionIntroHintVisible('smith_haldren', 'active', false)).toBe(true);
    expect(professionIntroHintVisible('smith_haldren', 'ready', false)).toBe(true);
    expect(professionIntroHintVisible('smith_haldren', 'unavailable', false)).toBe(true);
  });

  it('hides after q_prof_intro is completed', () => {
    expect(professionIntroHintVisible('smith_haldren', 'done', false)).toBe(false);
    for (const station of STATIONS) {
      expect(
        professionIntroHintVisible(station.masterNpcId, 'done', false),
        station.masterNpcId,
      ).toBe(false);
    }
  });

  it('hides for an attuned veteran in every non-done state (the veteran refinement)', () => {
    // An intro-skipping veteran with any archetype attunement has provably
    // found the guild: a permanent "go meet the guild" line would read as a
    // bug. Attunement alone retires the row in every remaining state.
    for (const state of ['unavailable', 'available', 'active', 'ready'] as const) {
      expect(professionIntroHintVisible('smith_haldren', state, true), state).toBe(false);
    }
    // The refinement never resurrects the row post-completion either.
    expect(professionIntroHintVisible('smith_haldren', 'done', true)).toBe(false);
  });

  it('never shows for a non-master NPC in any quest state', () => {
    const states: QuestState[] = ['unavailable', 'available', 'active', 'ready', 'done'];
    for (const state of states) {
      expect(professionIntroHintVisible('marshal_redbrook', state, false), state).toBe(false);
      expect(professionIntroHintVisible('foreman_odell', state, false), state).toBe(false);
    }
  });

  it('points at q_prof_intro, whose giver is Foreman Odell', () => {
    // The controller derives the hinted NPC from the quest record, so the row
    // follows the content if the intro ever moves; pin today's giver.
    expect(PROF_INTRO_QUEST_ID).toBe('q_prof_intro');
    expect(QUESTS[PROF_INTRO_QUEST_ID].giverNpcId).toBe('foreman_odell');
    expect(QUESTS[PROF_INTRO_QUEST_ID].turnInNpcId).toBe('foreman_odell');
  });

  it('pins the catalog key and its M16-safe template', () => {
    expect(PROF_INTRO_HINT_KEY).toBe('questUi.dialog.profIntroHint');
    // Pinned at the contributor source of truth (the catalog module); the
    // resolved runtime tables mirror it via i18n:gen, guarded by the
    // i18n_resolved_equivalence and freshness gates.
    const value = questStrings.en.questUi.dialog.profIntroHint;
    expect(value).toBe('See {name} for "{quest}".');
    // Both display names arrive via {placeholders} (already localized leaves),
    // and the template itself must never grow a 4-letter lowercase run: that
    // is the M16 wordy bar (tests/i18n_completeness.test.ts), which would flag
    // the key as untranslated English in every non-Latin locale while its
    // fills are pending. A reword that trips this needs non-Latin fills in the
    // same change.
    expect(/[a-z]{4,}/.test(value.replace(/\{[^}]*\}/g, ''))).toBe(false);
    expect(value).toContain('{name}');
    expect(value).toContain('{quest}');
  });
});
