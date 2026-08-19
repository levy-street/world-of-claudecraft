// The extracted HUD entity-naming rule (src/ui/entity_display_name.ts, the
// Phase 12 headroom extraction): which entities name by template, which keep
// their sim-authored wire name, and the placed feast's composed title. Runs
// in the default en locale, so every dictionary hop resolves synchronously.
import { describe, expect, it } from 'vitest';
import { MOBS, NPCS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_name';

function ent(over: Record<string, unknown>): Entity {
  return {
    id: 1,
    name: 'Wire Name',
    ownerId: null,
    templateId: '',
    pos: { x: 0, y: 0, z: 0 },
    ...over,
  } as unknown as Entity;
}

describe('entityDisplayName', () => {
  it('names a WILD mob by its template, never by the wire name', () => {
    const wolf = ent({ kind: 'mob', templateId: 'forest_wolf', name: 'raw wire name' });
    expect(entityDisplayName(wolf)).toBe(MOBS.forest_wolf.name);
    expect(entityDisplayName(wolf)).not.toBe('raw wire name');
  });

  it('keeps an OWNED mob on its sim-authored name when the matcher has no row', () => {
    const pet = ent({ kind: 'mob', templateId: 'yumi_cat', ownerId: 9, name: 'Fluffy' });
    expect(entityDisplayName(pet)).toBe('Fluffy');
  });

  it('names the necromancy undead by template even while owned (the carve-out)', () => {
    const guard = ent({ kind: 'mob', templateId: 'graveguard', ownerId: 9, name: 'raw' });
    expect(entityDisplayName(guard)).toBe(MOBS.graveguard.name);
  });

  it('names an NPC by its template', () => {
    const npcId = Object.keys(NPCS)[0];
    const npc = ent({ kind: 'npc', templateId: npcId, name: 'raw' });
    expect(entityDisplayName(npc)).toBe(NPCS[npcId].name);
  });

  it("composes the placed feast's localized title around the placer's raw name", () => {
    const feast = ent({ kind: 'object', templateId: 'farm_feast', name: 'Mira' });
    // The wire carries only the raw player name; the title is client-composed
    // (the i18n invariant: the text is a key, the name is a value).
    expect(entityDisplayName(feast)).toBe("Mira's Harvest Feast");
  });

  it('shows every other entity by its wire name as is', () => {
    expect(entityDisplayName(ent({ kind: 'object', templateId: 'mailbox', name: 'Mailbox' }))).toBe(
      'Mailbox',
    );
    expect(entityDisplayName(ent({ kind: 'player', name: 'Aldric' }))).toBe('Aldric');
  });
});
