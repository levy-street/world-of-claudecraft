import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import {
  attunementMasterForPair,
  planProfessionEvent,
} from '../src/ui/profession_event_lines_core';

describe('attunementMasterForPair', () => {
  it('resolves each wave-one pair to its attunement quest giver', () => {
    expect(attunementMasterForPair('weaponcrafting+armorcrafting')).toBe('forgemistress_darva');
    expect(attunementMasterForPair('leatherworking+tailoring')).toBe('weaver_ottilie');
    expect(attunementMasterForPair('alchemy+cooking')).toBe('cook_marlow');
    expect(attunementMasterForPair('engineering+alchemy')).toBe('tinker_gizzel');
  });

  it('returns null for a ring pair with no seated master', () => {
    // jewelcrafting+weaponcrafting is a real ring pair (a Guild trend letter and
    // a title exist), but no wave-one master offers its attunement quest.
    expect(attunementMasterForPair('jewelcrafting+weaponcrafting')).toBeNull();
    expect(attunementMasterForPair('not-a-pair')).toBeNull();
  });

  it('stays derived from the attunePair-new quest content (no drift)', () => {
    // Every mapping must come from a real attunePair 'new' quest, and the giver
    // it names must be that quest's actual giver.
    const master = attunementMasterForPair('alchemy+cooking');
    const quest = Object.values(QUESTS).find(
      (q) =>
        q.completionEffect?.type === 'attunePair' &&
        q.completionEffect.mode === 'new' &&
        q.completionEffect.pairId === 'alchemy+cooking',
    );
    expect(quest).toBeTruthy();
    expect(master).toBe(quest?.giverNpcId);
  });
});

describe('planProfessionEvent', () => {
  it('plans the trend nudge with its anchor master, or the no-master variant', () => {
    expect(
      planProfessionEvent({ type: 'profTrendNudge', pairId: 'engineering+alchemy' }, false),
    ).toEqual({
      kind: 'trendNudge',
      pairId: 'engineering+alchemy',
      masterNpcId: 'tinker_gizzel',
    });
    expect(
      planProfessionEvent(
        { type: 'profTrendNudge', pairId: 'jewelcrafting+weaponcrafting' },
        false,
      ),
    ).toEqual({
      kind: 'trendNudge',
      pairId: 'jewelcrafting+weaponcrafting',
      masterNpcId: null,
    });
  });

  it('plans the tier tutorial trigger', () => {
    expect(planProfessionEvent({ type: 'profTierTutorial' }, false)).toEqual({
      kind: 'tierTutorial',
    });
  });

  it('plans the zone attunement line carrying the celebrant name and pair', () => {
    expect(
      planProfessionEvent(
        { type: 'attunedZone', celebrantName: 'Ari', pairId: 'alchemy+cooking' },
        false,
      ),
    ).toEqual({ kind: 'attunedZone', celebrantName: 'Ari', pairId: 'alchemy+cooking' });
  });

  it('plans the personal attunement banner, gating motion but never sound', () => {
    expect(planProfessionEvent({ type: 'attuned', pairId: 'alchemy+cooking' }, false)).toEqual({
      kind: 'attunement',
      pairId: 'alchemy+cooking',
      playSound: true,
      motion: true,
    });
    // Reduced motion trims the flourish only; the sound (information cue) stays.
    expect(planProfessionEvent({ type: 'attuned', pairId: 'alchemy+cooking' }, true)).toEqual({
      kind: 'attunement',
      pairId: 'alchemy+cooking',
      playSound: true,
      motion: false,
    });
  });
});
