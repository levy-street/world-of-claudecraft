// @vitest-environment happy-dom
//
// The Thornhollow Fields queue-pop popup against the ONLINE arrival order.
// The bgProposed SimEvent rides the events frame while the offer state rides
// the next `bg` self snapshot, so at show() time `bgInfo.proposal` may not
// have arrived yet. The popup must ARM and wait for the snapshot (bounded by
// OFFER_SNAPSHOT_GRACE_POLLS of the mediumHud band that polls it), not read
// the gap as "offer resolved" and close for good: that misread is exactly the
// v0.36.0 "queue never pops" outage (zero matches seated from the v0.36.0
// deploy onward; the wire ordering itself is pinned by
// tests/battleground_pop_wire_order.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import {
  BgProposalPopup,
  OFFER_SNAPSHOT_GRACE_POLLS,
} from '../src/ui/hud/battleground/battleground_proposal_popup';
import type { BgInfo, IWorld } from '../src/world_api';

function bgInfoWith(proposal: BgInfo['proposal']): BgInfo {
  return {
    rating: 1500,
    wins: 0,
    losses: 0,
    draws: 0,
    captures: 0,
    queued: true,
    queueSize: 10,
    queuedParty: 1,
    proposal,
    requeueIn: 0,
    firstWinBonusReady: false,
    match: null,
    ladder: [],
  };
}

const OFFER: BgInfo['proposal'] = {
  id: 1,
  kind: 'match',
  size: 10,
  accepted: 0,
  myResponse: 'pending',
  remaining: 30,
};

interface Harness {
  popup: BgProposalPopup;
  root: HTMLElement;
  world: { bgInfo: BgInfo | null; bgRespond: ReturnType<typeof vi.fn> };
}

function makePopup(bgInfo: BgInfo | null): Harness {
  const root = document.createElement('div');
  root.style.display = 'none';
  const world = { bgInfo, bgRespond: vi.fn() };
  const popup = new BgProposalPopup({
    root: () => root,
    world: () => world as unknown as IWorld,
  });
  return { popup, root, world };
}

beforeEach(() => {
  vi.spyOn(audio, 'duelChallenge').mockImplementation(() => {});
  vi.spyOn(audio, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BgProposalPopup pending arrival (the online race)', () => {
  it('stays armed when the snapshot has not arrived, then opens when it lands', () => {
    const { popup, root, world } = makePopup(bgInfoWith(null));
    popup.show();
    // Armed, polled by hud.update, but not yet visible: there is nothing
    // truthful to paint before the snapshot arrives.
    expect(popup.isOpen).toBe(true);
    expect(root.style.display).not.toBe('block');
    // The snapshot lands one mediumHud poll later.
    world.bgInfo = bgInfoWith(OFFER);
    popup.render();
    expect(root.style.display).toBe('block');
    expect(root.getAttribute('role')).toBe('alert');
    const accept = root.querySelector<HTMLButtonElement>('[data-bgp="accept"]');
    expect(accept).not.toBeNull();
    accept?.click();
    expect(world.bgRespond).toHaveBeenCalledWith(true);
  });

  it('plays the cue once at show(), not per pending poll', () => {
    const { popup, world } = makePopup(bgInfoWith(null));
    popup.show();
    popup.render();
    popup.render();
    world.bgInfo = bgInfoWith(OFFER);
    popup.render();
    expect(audio.duelChallenge).toHaveBeenCalledTimes(1);
  });

  it('stays armed through the whole grace window, then gives up exactly at the budget', () => {
    const { popup, root } = makePopup(bgInfoWith(null));
    popup.show(); // burns poll 1 of the budget itself
    for (let i = 0; i < OFFER_SNAPSHOT_GRACE_POLLS - 2; i++) popup.render();
    // One poll left: still armed, still polled by hud.update, still hidden.
    expect(popup.isOpen).toBe(true);
    expect(root.style.display).not.toBe('block');
    popup.render(); // the last allowed poll runs the budget dry
    expect(popup.isOpen).toBe(false);
    expect(root.style.display).not.toBe('block');
  });

  it('opens when the offer arrives on the last allowed poll', () => {
    const { popup, root, world } = makePopup(bgInfoWith(null));
    popup.show();
    for (let i = 0; i < OFFER_SNAPSHOT_GRACE_POLLS - 2; i++) popup.render();
    expect(popup.isOpen).toBe(true);
    world.bgInfo = bgInfoWith(OFFER);
    popup.render();
    expect(root.style.display).toBe('block');
    expect(root.querySelector('[data-bgp="accept"]')).not.toBeNull();
  });

  it('opens immediately when the snapshot already carries the offer', () => {
    const { popup, root } = makePopup(bgInfoWith(OFFER));
    popup.show();
    expect(root.style.display).toBe('block');
    expect(root.querySelector('[data-bgp="decline"]')).not.toBeNull();
  });

  it('still closes the moment a shown offer resolves', () => {
    const { popup, root, world } = makePopup(bgInfoWith(OFFER));
    popup.show();
    expect(root.style.display).toBe('block');
    world.bgInfo = bgInfoWith(null);
    popup.render();
    expect(popup.isOpen).toBe(false);
    expect(root.style.display).toBe('none');
    expect(root.innerHTML).toBe('');
  });
});
