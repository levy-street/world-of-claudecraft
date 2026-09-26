// Pins the authored NPC look roster (src/render/characters/npc_looks.ts):
// coverage (EVERY NpcDef id resolves to a composed look), validity (every
// authored value survives normalizeAppearance byte-identical, so a typo'd
// style id cannot silently clamp to the default face), distinctness (no two
// NPCs share an appearance), and the manifest contract (every prop set has
// its derived npc_modular_<id> VisualDef, every def resolvable).

import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  ARMOR_SETS,
  ARMOR_SLOTS,
  NPC_MATERIAL_COLORWAY_IDS,
  normalizeAppearance,
  OUTFIT_COLORWAY_IDS,
} from '../src/render/characters/modular';
import {
  aldricKeepsHisRig,
  NPC_LOOKS,
  NPC_PROP_SET_IDS,
  normalizeNpcAppearance,
  npcLookFor,
  npcModularKeyFor,
} from '../src/render/characters/npc_looks';
import { NPCS } from '../src/sim/data';

describe('npc looks roster', () => {
  it('covers every NpcDef id except Brother Aldric (every other world NPC composes)', () => {
    const missing = Object.keys(NPCS).filter(
      (id) => !aldricKeepsHisRig(id) && npcLookFor(id) === null,
    );
    expect(missing).toEqual([]);
  });

  // Brother Aldric renders the pre-v0.7 npc_aldric model on purpose (the
  // community knows him by that silhouette; PR #499 already restored it once).
  // Composing him would be a regression, so his hub ids must resolve to null
  // AND carry no roster entry a later edit could quietly re-activate.
  it('never composes Brother Aldric, at any of his hub ids', () => {
    const aldricIds = Object.keys(NPCS).filter((id) => id.startsWith('brother_aldric'));
    expect(aldricIds.length).toBeGreaterThan(1);
    for (const id of aldricIds) {
      expect(aldricKeepsHisRig(id), id).toBe(true);
      expect(npcLookFor(id), id).toBeNull();
    }
    expect(Object.keys(NPC_LOOKS).filter((id) => id.startsWith('brother_aldric'))).toEqual([]);
  });

  it('covers the NPC-bodied quest actors and the dev vendor', () => {
    for (const id of [
      'ptr_dev_vendor',
      'fisher_bram',
      'apprentice_wren',
      'castaway_navigator',
      'gravedigger_mosley',
    ]) {
      expect(npcLookFor(id), id).not.toBeNull();
    }
  });

  it('keeps mob-kind Sexton Marrow on the mob visual while NPC-kind composes', () => {
    const npcLook = npcLookFor('sexton_marrow', 'npc');
    expect(npcLook).not.toBeNull();
    expect(npcLookFor('sexton_marrow')).toBe(npcLook);
    expect(npcLookFor('sexton_marrow', 'mob')).toBeNull();
    expect(visualKeyFor({ kind: 'mob', templateId: 'sexton_marrow' } as never)).toBe('skel_mage');
  });

  // Aldric's hub ids are covered by the dedicated null test above; asserting
  // alias equality on him here would compare null to null and pass vacuously.
  it('recurring characters share one look across their hub ids', () => {
    expect(npcLookFor('scout_maren')).not.toBeNull();
    expect(npcLookFor('scout_maren_highwatch')).toBe(npcLookFor('scout_maren'));
    expect(npcLookFor('brother_halven')).not.toBeNull();
    expect(npcLookFor('brother_halven_marsh')).toBe(npcLookFor('brother_halven'));
  });

  it('resolves to a stable object identity (caches key off it)', () => {
    for (const id of Object.keys(NPCS)) {
      expect(npcLookFor(id)).toBe(npcLookFor(id));
    }
  });

  it('every authored appearance value survives normalization unchanged', () => {
    for (const [id, def] of Object.entries(NPC_LOOKS)) {
      const normalized = normalizeNpcAppearance(def.app) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(def.app)) {
        expect(normalized[key], `${id}.${key}`).toEqual(value);
      }
    }
  });

  it('no two NPCs share an authored appearance', () => {
    const seen = new Map<string, string>();
    for (const [id, def] of Object.entries(NPC_LOOKS)) {
      const sig = JSON.stringify(normalizeNpcAppearance(def.app));
      const prior = seen.get(sig);
      expect(prior, `${id} duplicates ${prior}`).toBeUndefined();
      seen.set(sig, id);
    }
  });

  it('worn loadouts reference only real slots and sets', () => {
    for (const [id, def] of Object.entries(NPC_LOOKS)) {
      for (const [slot, set] of Object.entries(def.worn)) {
        expect(ARMOR_SLOTS, `${id} slot ${slot}`).toContain(slot);
        if (set !== null && set !== undefined) {
          expect(ARMOR_SETS, `${id} ${slot}=${set}`).toContain(set);
        }
      }
    }
  });

  it('every prop set derives a modular VisualDef, and every NPC resolves one', () => {
    for (const propSet of NPC_PROP_SET_IDS) {
      const def = VISUALS[`npc_modular_${propSet}`];
      expect(def, propSet).toBeDefined();
      expect(def.modular, propSet).toBe(true);
    }
    for (const id of [...Object.keys(NPCS), ...Object.keys(NPC_LOOKS)]) {
      const key = npcModularKeyFor(id);
      expect(VISUALS[key], `${id} -> ${key}`).toBeDefined();
    }
    const unknownPropSets = Object.entries(NPC_LOOKS)
      .filter(([, def]) => !NPC_PROP_SET_IDS.includes(def.props))
      .map(([id]) => id);
    expect(unknownPropSets).toEqual([]);
  });

  // The owner's "old sea wolf" brief for the Wyrmwatch harbormaster: a navy tricorne and
  // a pipe, the long navy coat with brass buttons and cuffs, a spyglass on her hip, a grey
  // braid and a weathered face. Every piece of it is pinned to what resolves at runtime.
  it('dresses Harbormaster Tamsin as a sea captain', () => {
    const look = npcLookFor('harbormaster_tamsin');
    expect(look).not.toBeNull();
    if (!look) return;
    // the long buttoned coat (the mage kit), dyed the NPC-only admiralty navy and brass
    expect(look.worn).toEqual({
      head: null,
      chest: 'mage',
      arms: 'mage',
      hands: 'rogue',
      legs: 'mage',
      feet: 'mage',
      back: 'mage',
    });
    expect(look.app.outfit).toBe('admiralty');
    // salt-grey braid, weathered: a squint and wind-burnt cheeks
    expect(look.app.gender).toBe('female');
    expect(look.app.hair).toBe('warriorbraid');
    expect(look.app.hairSat).toBeLessThanOrEqual(0.12);
    expect(look.app.hairLight).toBeGreaterThan(0.55);
    expect(look.app.eyeShape).toBe('narrow');
    expect(look.app.blush).toBe('warm');
    // the tricorne and pipe ride the head bone, the spyglass the hips bone
    const key = npcModularKeyFor('harbormaster_tamsin');
    expect(key).toBe('npc_modular_harbormaster');
    expect(VISUALS[key].attach).toEqual([
      { url: 'models/chars/npc_gear/harbormaster_tricorne.glb', bone: 'head' },
      { url: 'models/chars/npc_gear/harbormaster_spyglass.glb', bone: 'hips' },
    ]);
    expect(VISUALS[key].weaponSlots).toBeUndefined();
  });

  it('keeps NPC-only colorways off every player path', () => {
    for (const id of NPC_MATERIAL_COLORWAY_IDS) {
      expect(OUTFIT_COLORWAY_IDS as readonly string[]).not.toContain(id);
      // a player save carrying one is clamped to the default...
      expect(normalizeAppearance({ outfit: id } as never).outfit).toBe('classic');
      // ...while an authored NPC look keeps it
      expect(normalizeNpcAppearance({ outfit: id } as never).outfit).toBe(id);
    }
    // and the NPC normalizer is otherwise the player one, clamps included
    expect(normalizeNpcAppearance({ outfit: 'nonsense' } as never).outfit).toBe('classic');
    expect(normalizeNpcAppearance({ hair: 'nonsense' } as never)).toEqual(
      normalizeAppearance({ hair: 'nonsense' } as never),
    );
  });
});
