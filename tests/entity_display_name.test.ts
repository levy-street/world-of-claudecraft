// The extracted HUD entity-naming rule (src/ui/entity_display_name.ts, the
// Phase 12 headroom extraction): which entities name by template, which keep
// their sim-authored wire name, and the placed feast's composed title. Runs
// in the default en locale, so every dictionary hop resolves synchronously.
import { describe, expect, it } from 'vitest';
import { MOBS, NPCS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_name';
import { feastTitleKeyFor, feastTitleTemplateIds } from '../src/ui/feast_title';

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

// ---------------------------------------------------------------------------
// THE APEX FEAST TITLES (masterwrought Phase 11k). Decision K1 makes the placed
// title a FUNCTIONAL requirement rather than flavor: it is how a raider at the
// table learns which plate is on it. So a feast tier without its own key does
// not merely read oddly, it mislabels itself as the rung below.

describe('the apex feast titles', () => {
  it('composes each apex tier around the placer name, naming the plate it serves', () => {
    // One case per template, with the composed title as a LITERAL: the point
    // is that the three are DIFFERENT, which a derivation off the same map
    // could not show.
    expect(
      entityDisplayName(ent({ kind: 'object', templateId: 'stonepot_feast', name: 'Mira' })),
    ).toBe("Mira's Stonepot Feast");
    expect(
      entityDisplayName(ent({ kind: 'object', templateId: 'warspice_feast', name: 'Mira' })),
    ).toBe("Mira's Warspice Feast");
    expect(
      entityDisplayName(ent({ kind: 'object', templateId: 'sageleaf_feast', name: 'Mira' })),
    ).toBe("Mira's Sageleaf Feast");
    // And none of them is the rung below, which is the regression that matters.
    for (const templateId of ['stonepot_feast', 'warspice_feast', 'sageleaf_feast']) {
      expect(
        entityDisplayName(ent({ kind: 'object', templateId, name: 'Mira' })),
        templateId,
      ).not.toBe("Mira's Harvest Feast");
    }
  });

  it('the raw wire name is a VALUE and is never translated', () => {
    // The i18n invariant: the text is the key, the name is the param. A player
    // called "Harvest Feast" must still come through verbatim inside the title.
    const odd = ent({ kind: 'object', templateId: 'stonepot_feast', name: 'Zháng' });
    expect(entityDisplayName(odd)).toBe("Zháng's Stonepot Feast");
  });

  it('EVERY feast the catalog ships has a title key, and nothing else does', () => {
    // The exhaustiveness pin, and the reason the key map may be hand-written:
    // authoring a feast def without a title key would otherwise fall through
    // to the raw player name, which is both the wrong label and an i18n leak.
    // Derived from the sim's own family so the two cannot drift, with the
    // literal beside it because a derivation alone follows the table down.
    const templates = feastTitleTemplateIds();
    expect(templates).toEqual(['farm_feast', 'sageleaf_feast', 'stonepot_feast', 'warspice_feast']);
    for (const templateId of templates) {
      expect(feastTitleKeyFor(templateId), templateId).not.toBeNull();
      // And the composed title actually resolves, rather than the key merely
      // existing: a key with no catalog row throws in test, so this is what
      // proves the three new rows landed in the catalog too.
      const title = entityDisplayName(ent({ kind: 'object', templateId, name: 'Mira' }));
      expect(title.startsWith("Mira's "), templateId).toBe(true);
      expect(title, templateId).not.toBe('Mira');
    }
    expect(feastTitleKeyFor('farm_bed'), 'a non-feast object has no title key').toBeNull();
    expect(feastTitleKeyFor(undefined)).toBeNull();
  });
});
