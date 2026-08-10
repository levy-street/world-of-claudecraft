import { describe, expect, it } from 'vitest';
import { buildBgProposalPopupView } from '../src/ui/hud/battleground';
import type { BgInfo, BgProposalInfo } from '../src/world_api';

const info = (proposal: BgProposalInfo | null): BgInfo => ({
  rating: 1500,
  wins: 0,
  losses: 0,
  draws: 0,
  captures: 0,
  queued: false,
  queueSize: 0,
  queuedParty: 1,
  firstWinBonusReady: false,
  proposal,
  requeueIn: 0,
  match: null,
  ladder: [],
});

const offer = (over: Partial<BgProposalInfo> = {}): BgProposalInfo => ({
  id: 7,
  kind: 'match',
  size: 10,
  accepted: 3,
  myResponse: 'pending',
  remaining: 21,
  ...over,
});

describe('buildBgProposalPopupView', () => {
  it('is null with no offer, which is how the popup learns to close itself', () => {
    expect(buildBgProposalPopupView(null)).toBeNull();
    expect(buildBgProposalPopupView(info(null))).toBeNull();
  });

  it('carries the tally, my answer and the clock', () => {
    const view = buildBgProposalPopupView(info(offer()))!;
    expect(view.accepted).toBe(3);
    expect(view.size).toBe(10);
    expect(view.full).toBe(false);
    expect(view.myResponse).toBe('pending');
    expect(view.remaining).toBe(21);
  });

  it('reads full only when every fighter has accepted', () => {
    expect(buildBgProposalPopupView(info(offer({ accepted: 9 })))!.full).toBe(false);
    expect(buildBgProposalPopupView(info(offer({ accepted: 10 })))!.full).toBe(true);
  });

  it('clamps a count that arrived over the wire past the roster', () => {
    // A meter wider than its own track is the visible symptom; the wire is not
    // the client's to trust, so the core refuses the value rather than paint it.
    const over = buildBgProposalPopupView(info(offer({ accepted: 14 })))!;
    expect(over.accepted).toBe(10);
    expect(over.full).toBe(true);
    expect(buildBgProposalPopupView(info(offer({ accepted: -2 })))!.accepted).toBe(0);
  });

  it('floors a negative countdown rather than painting it', () => {
    expect(buildBgProposalPopupView(info(offer({ remaining: -1 })))!.remaining).toBe(0);
  });

  it('leaves the countdown OUT of the signature, so a second does not rebuild the prompt', () => {
    // The decisive one. A countdown inside the signature would rebuild the whole
    // popup once per second and drop a half-pressed button under the player.
    const a = buildBgProposalPopupView(info(offer({ remaining: 30 })))!;
    const b = buildBgProposalPopupView(info(offer({ remaining: 4 })))!;
    expect(a.sig).toBe(b.sig);
  });

  it('moves the signature for every structural change, one dimension at a time', () => {
    const base = buildBgProposalPopupView(info(offer()))!.sig;
    for (const over of [
      { id: 8 },
      { accepted: 4 },
      { size: 6 },
      { myResponse: 'accepted' as const },
    ]) {
      expect(buildBgProposalPopupView(info(offer(over)))!.sig, JSON.stringify(over)).not.toBe(base);
    }
  });

  it('never carries a name: the ten stay anonymous until the match forms', () => {
    // The promise is made sim-side (bgInfoFor ships counts only); this asserts
    // the core adds no field that could break it downstream.
    const view = buildBgProposalPopupView(info(offer()))!;
    expect(Object.keys(view).sort()).toEqual([
      'accepted',
      'full',
      // The offer KIND is a category, never an identity: it says whether this
      // is a fresh match or a live one, and names nobody.
      'kind',
      'myResponse',
      'remaining',
      'sig',
      'size',
    ]);
  });
});
