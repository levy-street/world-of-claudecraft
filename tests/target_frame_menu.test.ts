// The target-frame unit menu's PURE half (src/ui/hud/target_frame_menu.ts):
// which menu a target opens, and the buddy menu's markup. Extracted out of
// hud.ts so exactly this can be driven without a document; before the
// extraction the routing chain was an if/else ladder inside a DOM handler and
// nothing covered it.

import { describe, expect, it } from 'vitest';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import type { Entity } from '../src/sim/types';
import {
  buddyMenuHtml,
  raidTargetMenuHtml,
  targetFrameMenuKind,
} from '../src/ui/hud/target_frame_menu';
import type { RaidTargetMarking } from '../src/ui/raid_target_icons_core';

const ME = 1;

// Only the five fields the router reads; the real Entity is far wider.
function unit(partial: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    name: 'Unit',
    templateId: 'forest_wolf',
    ownerId: null,
    dead: false,
    hostile: true,
    ...partial,
  } as Entity;
}

// Marking contexts: no group, a party (anyone marks), a raid led by someone else.
const MATE = 7;
const OUTSIDER = 9;
const inGroup = (pid: number) => pid === ME || pid === MATE;
const PARTY: RaidTargetMarking = { canMark: true, inGroup };
const RAID_MEMBER: RaidTargetMarking = { canMark: false, inGroup };

describe('targetFrameMenuKind', () => {
  it('opens the social menu for another player; yourself gets the marker picker in a group', () => {
    expect(targetFrameMenuKind(unit({ kind: 'player', id: 7 }), ME, null)).toBe('player');
    expect(targetFrameMenuKind(unit({ kind: 'player', id: ME }), ME, null)).toBeNull();
    expect(targetFrameMenuKind(unit({ kind: 'player', id: ME }), ME, PARTY)).toBe('marker');
    expect(targetFrameMenuKind(unit({ kind: 'player', id: ME }), ME, RAID_MEMBER)).toBeNull();
  });

  it('opens the pet menu for your own pet and the buddy menu for your own buddy', () => {
    const pet = unit({ ownerId: ME, templateId: 'pet_wolf', hostile: false });
    expect(targetFrameMenuKind(pet, ME, null)).toBe('pet');
    expect(targetFrameMenuKind(pet, ME, PARTY)).toBe('pet');
    const buddy = unit({ ownerId: ME, templateId: buddyTemplateId('horse'), hostile: false });
    expect(targetFrameMenuKind(buddy, ME, PARTY)).toBe('buddy');
  });

  it("offers the marker picker on a group member's pet or buddy, never an outsider's", () => {
    const mateBuddy = unit({ ownerId: MATE, templateId: buddyTemplateId('forgemaw') });
    expect(targetFrameMenuKind(mateBuddy, ME, PARTY)).toBe('marker');
    expect(targetFrameMenuKind(mateBuddy, ME, RAID_MEMBER)).toBeNull();
    const theirPet = unit({ ownerId: OUTSIDER, templateId: 'pet_wolf', hostile: false });
    expect(targetFrameMenuKind(theirPet, ME, PARTY)).toBeNull();
  });

  it('offers the marker picker on a live wild mob, hostile or friendly, with marking rights', () => {
    expect(targetFrameMenuKind(unit({}), ME, PARTY)).toBe('marker');
    expect(targetFrameMenuKind(unit({ hostile: false }), ME, PARTY)).toBe('marker');
    expect(targetFrameMenuKind(unit({}), ME, null)).toBeNull();
    expect(targetFrameMenuKind(unit({}), ME, RAID_MEMBER)).toBeNull();
    expect(targetFrameMenuKind(unit({ dead: true }), ME, PARTY)).toBeNull();
    expect(targetFrameMenuKind(unit({ kind: 'npc', hostile: false }), ME, PARTY)).toBeNull();
  });
});

describe('raidTargetMenuHtml', () => {
  it('lists the eight symbols, checks the current one, and escapes the name', () => {
    const html = raidTargetMenuHtml('<b>Ogre</b>', 7, (s) => `data:icon/${s}`);
    expect(html.match(/data-act="m\d"/g)).toHaveLength(8);
    expect(html).toContain('data-act="clear"');
    expect(html).toContain('data-act="close"');
    expect(html.match(/ctx-selected/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Skull marker selected"');
    expect(html).toContain('data:icon/0');
    expect(html).not.toContain('<b>');
  });
});

describe('buddyMenuHtml', () => {
  it('offers the flip of the CURRENT armed state, and escapes the buddy name', () => {
    expect(buddyMenuHtml('Fox', false)).toContain('Enable Autoloot');
    expect(buddyMenuHtml('Fox', false)).not.toContain('Disable Autoloot');
    expect(buddyMenuHtml('Fox', true)).toContain('Disable Autoloot');
    const evil = buddyMenuHtml('<img src=x onerror=alert(1)>', false);
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;img');
  });

  it('carries exactly the three rows the opener binds', () => {
    const html = buddyMenuHtml('Fox', false);
    expect(html).toContain('data-act="rename"');
    expect(html).toContain('data-act="autoloot"');
    expect(html).toContain('data-act="close"');
    expect(html.match(/data-act=/g)).toHaveLength(3);
  });

  it('adds the Raid Target Icon row only when asked', () => {
    expect(buddyMenuHtml('Fox', false, true)).toContain('data-act="raid-target"');
    expect(buddyMenuHtml('Fox', false, true).match(/data-act=/g)).toHaveLength(4);
  });
});
