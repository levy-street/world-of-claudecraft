// The target-frame unit menu's PURE half (src/ui/hud/target_frame_menu.ts):
// which menu a target opens, and the buddy menu's markup. Extracted out of
// hud.ts so exactly this can be driven without a document; before the
// extraction the routing chain was an if/else ladder inside a DOM handler and
// nothing covered it.

import { describe, expect, it } from 'vitest';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import type { Entity } from '../src/sim/types';
import { buddyMenuHtml, targetFrameMenuKind } from '../src/ui/hud/target_frame_menu';

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

describe('targetFrameMenuKind', () => {
  it('opens the social menu for another player, and nothing for yourself', () => {
    expect(targetFrameMenuKind(unit({ kind: 'player', id: 7 }), ME, false)).toBe('player');
    expect(targetFrameMenuKind(unit({ kind: 'player', id: ME }), ME, false)).toBeNull();
  });

  it('opens the pet menu for your own pet and the buddy menu for your own buddy', () => {
    const pet = unit({ ownerId: ME, templateId: 'pet_wolf', hostile: false });
    expect(targetFrameMenuKind(pet, ME, false)).toBe('pet');
    const buddy = unit({ ownerId: ME, templateId: buddyTemplateId('ember_fox'), hostile: false });
    expect(targetFrameMenuKind(buddy, ME, false)).toBe('buddy');
  });

  it('offers nothing for someone else’s pet or buddy', () => {
    const theirPet = unit({ ownerId: 9, templateId: 'pet_wolf', hostile: false });
    expect(targetFrameMenuKind(theirPet, ME, true)).toBeNull();
    const theirBuddy = unit({ ownerId: 9, templateId: buddyTemplateId('frog'), hostile: false });
    expect(targetFrameMenuKind(theirBuddy, ME, true)).toBeNull();
  });

  it('offers the raid marker only for a live wild hostile mob, and only in a party', () => {
    expect(targetFrameMenuKind(unit({}), ME, true)).toBe('marker');
    expect(targetFrameMenuKind(unit({}), ME, false)).toBeNull();
    expect(targetFrameMenuKind(unit({ dead: true }), ME, true)).toBeNull();
    expect(targetFrameMenuKind(unit({ hostile: false }), ME, true)).toBeNull();
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

  it('carries exactly the two rows the opener binds', () => {
    const html = buddyMenuHtml('Fox', false);
    expect(html).toContain('data-act="autoloot"');
    expect(html).toContain('data-act="close"');
    expect(html.match(/data-act=/g)).toHaveLength(2);
  });
});
