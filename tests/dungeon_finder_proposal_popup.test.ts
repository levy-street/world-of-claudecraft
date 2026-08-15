// @vitest-environment happy-dom
//
// The Dungeon Finder "group found" popup against the ONLINE arrival order:
// the same pending-arrival contract as the battleground twin
// (tests/battleground_proposal_popup.test.ts), and the same defect when it is
// absent. The `df` self key rides a 2 Hz cadence with NO event-driven reset,
// so here the snapshot can trail the dfProposal event by up to half a second:
// this popup needs the armed grace even more than the battleground one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import {
  DungeonFinderProposalPopup,
  OFFER_SNAPSHOT_GRACE_POLLS,
} from '../src/ui/dungeon_finder_proposal_popup';
import type { DungeonFinderInfo, IWorld } from '../src/world_api';

function finderInfoWith(proposal: DungeonFinderInfo['proposal']): DungeonFinderInfo {
  return {
    roles: ['dps'],
    eligibleRoles: ['dps'],
    queue: null,
    cooldown: 0,
    proposal,
    myListing: null,
    myApplication: null,
  };
}

const OFFER: DungeonFinderInfo['proposal'] = {
  id: 1,
  activityId: 'hollow_crypt_normal',
  role: 'dps',
  size: 5,
  accepted: 0,
  acceptedByRole: { tank: 0, healer: 0, dps: 0 },
  myResponse: 'pending',
  remaining: 30,
};

interface Harness {
  popup: DungeonFinderProposalPopup;
  root: HTMLElement;
  world: {
    dungeonFinderInfo: DungeonFinderInfo | null;
    dungeonFinderRespond: ReturnType<typeof vi.fn>;
  };
}

function makePopup(info: DungeonFinderInfo | null): Harness {
  const root = document.createElement('div');
  root.style.display = 'none';
  const world = { dungeonFinderInfo: info, dungeonFinderRespond: vi.fn() };
  const popup = new DungeonFinderProposalPopup({
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

describe('DungeonFinderProposalPopup pending arrival (the online race)', () => {
  it('stays armed when the snapshot has not arrived, then opens when it lands', () => {
    const { popup, root, world } = makePopup(finderInfoWith(null));
    popup.show();
    expect(popup.isOpen).toBe(true);
    expect(root.style.display).not.toBe('block');
    world.dungeonFinderInfo = finderInfoWith(OFFER);
    popup.render();
    expect(root.style.display).toBe('block');
    expect(root.getAttribute('role')).toBe('alert');
    const accept = root.querySelector<HTMLButtonElement>('[data-dfp="accept"]');
    expect(accept).not.toBeNull();
    accept?.click();
    expect(world.dungeonFinderRespond).toHaveBeenCalledWith(true);
  });

  it('plays the cue once at show(), not per pending poll', () => {
    const { popup, world } = makePopup(finderInfoWith(null));
    popup.show();
    popup.render();
    popup.render();
    world.dungeonFinderInfo = finderInfoWith(OFFER);
    popup.render();
    expect(audio.duelChallenge).toHaveBeenCalledTimes(1);
  });

  it('stays armed through the whole grace window, then gives up exactly at the budget', () => {
    const { popup, root } = makePopup(finderInfoWith(null));
    popup.show(); // burns poll 1 of the budget itself
    for (let i = 0; i < OFFER_SNAPSHOT_GRACE_POLLS - 2; i++) popup.render();
    expect(popup.isOpen).toBe(true);
    expect(root.style.display).not.toBe('block');
    popup.render(); // the last allowed poll runs the budget dry
    expect(popup.isOpen).toBe(false);
    expect(root.style.display).not.toBe('block');
  });

  it('opens when the proposal arrives on the last allowed poll', () => {
    const { popup, root, world } = makePopup(finderInfoWith(null));
    popup.show();
    for (let i = 0; i < OFFER_SNAPSHOT_GRACE_POLLS - 2; i++) popup.render();
    expect(popup.isOpen).toBe(true);
    world.dungeonFinderInfo = finderInfoWith(OFFER);
    popup.render();
    expect(root.style.display).toBe('block');
    expect(root.querySelector('[data-dfp="accept"]')).not.toBeNull();
  });

  it('opens immediately when the snapshot already carries the offer', () => {
    const { popup, root } = makePopup(finderInfoWith(OFFER));
    popup.show();
    expect(root.style.display).toBe('block');
    expect(root.querySelector('[data-dfp="decline"]')).not.toBeNull();
  });

  it('still closes the moment a shown offer resolves', () => {
    const { popup, root, world } = makePopup(finderInfoWith(OFFER));
    popup.show();
    expect(root.style.display).toBe('block');
    world.dungeonFinderInfo = finderInfoWith(null);
    popup.render();
    expect(popup.isOpen).toBe(false);
    expect(root.style.display).toBe('none');
    expect(root.innerHTML).toBe('');
  });
});
