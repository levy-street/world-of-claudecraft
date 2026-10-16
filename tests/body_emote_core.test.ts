// src/render/body_emote_core.ts: players and talking NPCs (the dungeon guides)
// play their overhead emote; mobs, ground objects and the dead never do.
import { describe, expect, it } from 'vitest';
import { bodyEmoteId } from '../src/render/body_emote_core';

describe('bodyEmoteId', () => {
  it('plays for a living player or NPC, never a mob, an object or the dead', () => {
    expect(bodyEmoteId({ kind: 'player', overheadEmoteId: 'wave', dead: false })).toBe('wave');
    expect(bodyEmoteId({ kind: 'npc', overheadEmoteId: 'point', dead: false })).toBe('point');
    expect(bodyEmoteId({ kind: 'mob', overheadEmoteId: 'roar', dead: false })).toBeNull();
    expect(bodyEmoteId({ kind: 'object', overheadEmoteId: 'wave', dead: false })).toBeNull();
    expect(bodyEmoteId({ kind: 'npc', overheadEmoteId: 'point', dead: true })).toBeNull();
    expect(bodyEmoteId({ kind: 'player', overheadEmoteId: null, dead: false })).toBeNull();
  });
});
