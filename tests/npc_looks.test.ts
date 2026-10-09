// Pins the authored NPC look roster (src/render/characters/npc_looks.ts):
// coverage (EVERY NpcDef id resolves to a look on a WOC body), validity (every
// authored value is one the look's own head type offers and survives
// normalizeAppearance byte-identical, so a typo'd id cannot silently fall back
// to the type's default face), reach (every value is one the character
// creator's face builder can produce), distinctness (no two NPCs share an
// appearance), and the manifest contract (the class body each NPC rides, the
// fixed props it holds in place of that class's own weapons).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import {
  characterPreloadUrls,
  NPC_PROP_ATTACH,
  npcHeldProps,
  VISUALS,
  visualKeyFor,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import {
  normalizeAppearance,
  WOC_BODY_SCALE_RANGE,
  wocHeadLookOf,
} from '../src/render/characters/modular';
import {
  MOB_LOOK_IDS,
  NPC_LOOKS,
  NPC_OWN_BODY_IDS,
  NPC_PROP_SET_IDS,
  type NpcLookDef,
  npcLookFor,
} from '../src/render/characters/npc_looks';
import {
  resolveWocHeadLook,
  WOC_HEAD_MORPH_KEYS,
  WOC_HEAD_MORPH_RANGE,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_IDS,
  type WocHeadSlot,
  wocHeadTypeForGender,
} from '../src/render/characters/woc_head_catalog';
import { wocWornHidesHair } from '../src/render/characters/woc_head_look_core';
import { WOC_BODY_CLASSES, wocDefaultWorn } from '../src/render/characters/woc_parts_core';
import { ESCORTS, NPCS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const npc = (templateId: string): Entity => ({ kind: 'npc', templateId }) as unknown as Entity;
const roster = Object.entries(NPC_LOOKS) as [string, NpcLookDef][];

const SLOT_FIELD: Record<WocHeadSlot, keyof NpcLookDef['app']> = {
  hair: 'headHair',
  beard: 'headBeard',
  nose: 'headNose',
  mouth: 'headMouth',
  brows: 'headBrows',
  ears: 'headEars',
  eyes: 'headEyes',
};

describe('npc looks roster', () => {
  it('covers every NpcDef id: every world NPC wears an authored look but the own-body ones', () => {
    const missing = Object.keys(NPCS).filter(
      (id) => !NPC_OWN_BODY_IDS.has(id) && npcLookFor(id) === null,
    );
    expect(missing).toEqual([]);
  });

  // The NPCs with their own authored body (Laverock) keep it: no composed
  // look, no roster entry a later edit could re-activate, and a real NPC
  // whose visual key resolves to a shipped VisualDef.
  it('keeps the own-body NPCs on their authored bodies', () => {
    for (const id of NPC_OWN_BODY_IDS) {
      expect(NPCS[id], id).toBeDefined();
      expect(npcLookFor(id), id).toBeNull();
      expect(Object.hasOwn(NPC_LOOKS, id), id).toBe(false);
      const key = visualKeyFor({ kind: 'npc', templateId: id } as Entity);
      expect(VISUALS[key], `${id} -> ${key}`).toBeDefined();
      expect(key.startsWith('npc_modular_'), key).toBe(false);
    }
  });

  it('covers the dev vendor and the look-only quest actors', () => {
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

  // The quest escortees are MOB-kind (the escort driver walks them: sim/escort.ts) and
  // draw as the townsfolk they are: each wears its roster row on the WOC body of its
  // class, exactly as an NPC does. The bodies are literals, so a row that changed class
  // or body type, or a dispatch that fell back to a stock rig, fails here.
  it('draws the mob-kind escortees on the class body their roster row names', () => {
    // every quest escortee (a world-quest caravan is a wagon, not a person)
    const escortees = Object.values(ESCORTS)
      .filter((def) => def.worldQuestId === undefined)
      .map((def) => def.npcMobId)
      .sort();
    expect(escortees).toEqual([
      'apprentice_wren',
      'castaway_navigator',
      'fisher_bram',
      'gravedigger_mosley',
    ]);
    // the mob ids that wear a look are exactly those: none missed, none extra
    expect([...MOB_LOOK_IDS].sort()).toEqual(escortees);
    const bodies: Record<string, string> = {
      apprentice_wren: 'player_mage_female',
      castaway_navigator: 'player_rogue',
      fisher_bram: 'player_rogue',
      gravedigger_mosley: 'player_rogue',
    };
    for (const id of escortees) {
      const look = npcLookFor(id, 'mob');
      expect(look, id).not.toBeNull();
      // one resolved look whatever the kind asks (the caches key off its identity)
      expect(look, id).toBe(npcLookFor(id));
      const key = visualKeyFor({ kind: 'mob', templateId: id, family: 'humanoid' } as never);
      expect(key, id).toBe(bodies[id]);
      expect(VISUALS[key].wocCharacter?.fit, id).toBe(look?.app.gender);
    }
    // Mosley carries his axe; the other three walk empty handed
    expect(npcLookFor('gravedigger_mosley', 'mob')?.props).toBe('woodaxe');
    expect(npcHeldProps('woodaxe').attach).toEqual([
      { url: 'models/weapons/notched_woodaxe.glb', bone: 'handslot.r' },
    ]);
    for (const id of ['apprentice_wren', 'castaway_navigator', 'fisher_bram']) {
      expect(npcLookFor(id, 'mob')?.props, id).toBe('none');
    }
  });

  // Only a named mob wears a look: every other mob keeps the body the mob tables give
  // it, whether or not its id has a roster row.
  it('gives no other mob a look, in a fresh module world and in either ask order', async () => {
    vi.resetModules();
    const fresh = await import('../src/render/characters/npc_looks');
    // asked as a mob FIRST: the refusal must not be remembered for the NPC
    expect(fresh.npcLookFor('sexton_marrow', 'mob')).toBeNull();
    expect(fresh.npcLookFor('sexton_marrow')).not.toBeNull();
    // ...and the NPC's resolved look must not leak back to the mob
    expect(fresh.npcLookFor('sexton_marrow', 'mob')).toBeNull();
    for (const id of Object.keys(NPC_LOOKS)) {
      expect(fresh.npcLookFor(id, 'mob') !== null, id).toBe(fresh.MOB_LOOK_IDS.has(id));
      expect(fresh.npcLookFor(id, 'object'), id).toBeNull();
      expect(fresh.npcLookFor(id, 'player'), id).toBeNull();
    }
  });

  // The roster walk above covers every NpcDef; this one covers the world itself, so an
  // NPC the world places from a table the roster walk does not see still wears a look.
  it('every NPC a fresh world places wears a look', () => {
    const sim = new Sim({ seed: 20061, playerClass: 'warrior', noPlayer: true });
    const placed = [...sim.entities.values()].filter((e) => e.kind === 'npc');
    expect(placed.length).toBeGreaterThan(80);
    const bare = placed.filter((e) => npcLookFor(e.templateId, e.kind) === null);
    expect(bare.map((e) => e.templateId)).toEqual([]);
    for (const e of placed)
      expect(VISUALS[visualKeyFor(e)].wocCharacter, e.templateId).toBeDefined();
  });

  it('keeps mob-kind Sexton Marrow on the mob visual while the NPC wears his look', () => {
    const npcLook = npcLookFor('sexton_marrow', 'npc');
    expect(npcLook).not.toBeNull();
    expect(npcLookFor('sexton_marrow')).toBe(npcLook);
    expect(npcLookFor('sexton_marrow', 'mob')).toBeNull();
    // The Hollow Crypt rework gave the boss his own Blender body (the stooped
    // skeletal gravedigger with his spade and lantern), still a mob visual and
    // never the composed NPC look.
    const mobKey = visualKeyFor({ kind: 'mob', templateId: 'sexton_marrow' } as never);
    expect(mobKey).toBe('crypt_skel_sexton');
    expect(VISUALS[mobKey].url).toMatch(/creatures\/crypt_sexton_marrow\.glb$/);
    expect(VISUALS[mobKey].modular).toBeFalsy();
  });

  it('recurring characters share one look across their hub ids', () => {
    expect(npcLookFor('scout_maren')).not.toBeNull();
    expect(npcLookFor('scout_maren_highwatch')).toBe(npcLookFor('scout_maren'));
    expect(npcLookFor('brother_halven')).not.toBeNull();
    expect(npcLookFor('brother_halven_marsh')).toBe(npcLookFor('brother_halven'));
    // Brother Aldric stands in every hub, the same priest in each
    const aldricIds = Object.keys(NPCS).filter((id) => id.startsWith('brother_aldric'));
    expect(aldricIds.length).toBeGreaterThan(1);
    const aldric = npcLookFor('brother_aldric');
    expect(aldric?.cls).toBe('priest');
    for (const id of aldricIds) {
      expect(npcLookFor(id), id).toBe(aldric);
      expect(visualKeyFor(npc(id)), id).toBe('player_priest');
    }
    expect(aldricIds).toContain('brother_aldric_raid');
    // one roster entry, never a suffixed copy a later edit could let drift
    expect(Object.keys(NPC_LOOKS).filter((id) => id.startsWith('brother_aldric'))).toEqual([
      'brother_aldric',
    ]);
  });

  it('resolves to a stable object identity (caches key off it)', () => {
    for (const id of Object.keys(NPCS)) {
      expect(npcLookFor(id)).toBe(npcLookFor(id));
    }
  });

  it('every authored appearance value survives normalization unchanged', () => {
    for (const [id, def] of roster) {
      const normalized = normalizeAppearance(def.app) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(def.app)) {
        expect(normalized[key], `${id}.${key}`).toEqual(value);
      }
    }
  });

  // normalizeAppearance keeps any id SOME head type offers, and the head resolves another
  // type's id to this type's default at draw time: a Type A hairstyle on a Type B body
  // would pass the check above and still draw the wrong hair.
  it("every head pick is one the look's own head type offers", () => {
    for (const [id, def] of roster) {
      const type = wocHeadTypeForGender(def.app.gender);
      for (const slot of WOC_HEAD_SLOTS) {
        const offered = WOC_HEAD_TYPES[type].slots[slot].map((x) => x.id);
        expect(offered, `${id}.${SLOT_FIELD[slot]}`).toContain(def.app[SLOT_FIELD[slot]]);
      }
      expect(WOC_PIERCING_IDS, `${id}.headPiercing`).toContain(def.app.headPiercing);
      // ...so what the head draws is exactly what was authored
      const drawn = resolveWocHeadLook(type, wocHeadLookOf(normalizeAppearance(def.app)));
      expect(drawn, id).toEqual({
        hair: def.app.headHair,
        beard: def.app.headBeard,
        nose: def.app.headNose,
        mouth: def.app.headMouth,
        brows: def.app.headBrows,
        ears: def.app.headEars,
        eyes: def.app.headEyes,
        piercing: def.app.headPiercing,
      });
    }
  });

  it("keeps every face control and body size inside the creator's ranges", () => {
    for (const [id, def] of roster) {
      for (const k of WOC_HEAD_MORPH_KEYS) {
        const v = def.app.headShape?.[k];
        if (v === undefined) continue;
        expect(v, `${id}.headShape.${k}`).toBeGreaterThanOrEqual(WOC_HEAD_MORPH_RANGE[k].min);
        expect(v, `${id}.headShape.${k}`).toBeLessThanOrEqual(WOC_HEAD_MORPH_RANGE[k].max);
      }
      const size = def.app.bodyScale ?? WOC_BODY_SCALE_RANGE.def;
      expect(size, `${id}.bodyScale`).toBeGreaterThanOrEqual(WOC_BODY_SCALE_RANGE.min);
      expect(size, `${id}.bodyScale`).toBeLessThanOrEqual(WOC_BODY_SCALE_RANGE.max);
    }
  });

  it('gives the cast faces and heights of its own, not one stamped face', () => {
    // the face controls and the body size are what make a crowd read as people: a roster
    // edit that reset them all to the sculpt would pass every validity check above
    const moved = (k: (typeof WOC_HEAD_MORPH_KEYS)[number]) =>
      roster.filter(([, def]) => {
        const v = def.app.headShape?.[k];
        return v !== undefined && Math.abs(v - WOC_HEAD_MORPH_RANGE[k].def) >= 0.3;
      }).length;
    for (const k of ['eyeSpacing', 'eyeSize', 'eyeTilt', 'browHeight'] as const) {
      expect(moved(k), k).toBeGreaterThanOrEqual(20);
    }
    const sizes = new Set(roster.map(([, def]) => def.app.bodyScale ?? 1));
    expect(sizes.size).toBeGreaterThanOrEqual(8);
    expect(sizes.has(WOC_BODY_SCALE_RANGE.min)).toBe(true);
    expect(sizes.has(WOC_BODY_SCALE_RANGE.max)).toBe(true);
    const pierced = roster.filter(([, def]) => def.app.headPiercing !== 'none').length;
    expect(pierced).toBeGreaterThanOrEqual(20);
  });

  it('no two NPCs share an authored appearance', () => {
    const seen = new Map<string, string>();
    for (const [id, def] of roster) {
      const sig = JSON.stringify(normalizeAppearance(def.app));
      const prior = seen.get(sig);
      expect(prior, `${id} duplicates ${prior}`).toBeUndefined();
      seen.set(sig, id);
    }
  });

  it('every NPC rides the WOC body of its class and body type', () => {
    for (const id of [...Object.keys(NPCS), ...Object.keys(NPC_LOOKS)]) {
      const look = npcLookFor(id);
      expect(look, id).not.toBeNull();
      if (!look) continue;
      expect(WOC_BODY_CLASSES.has(look.cls), `${id}: ${look.cls}`).toBe(true);
      const key = visualKeyFor(npc(id));
      expect(key, id).toBe(`player_${look.cls}${look.app.gender === 'female' ? '_female' : ''}`);
      const def = VISUALS[key];
      expect(def?.wocCharacter, `${id} -> ${key}`).toBeDefined();
      // the body file follows the authored body type, as it does for a player
      expect(def.wocCharacter?.fit, id).toBe(look.app.gender);
      expect(key.endsWith('_female'), id).toBe(look.app.gender === 'female');
    }
  });

  // The dressing leaves an NPC's head slot empty (createCharacterVisual). That uncovers
  // the face only if the head slot is where every class kit keeps its helm or hood: a kit
  // whose hood rode another slot would still hide the authored hair.
  it('no class kit hides the hair once its head slot is empty, on either body', () => {
    let kits = 0;
    for (const cls of WOC_BODY_CLASSES) {
      for (const key of [`player_${cls}`, `player_${cls}_female`]) {
        const manifest = VISUALS[key]?.wocCharacter;
        expect(manifest, key).toBeDefined();
        if (!manifest) continue;
        const full = wocDefaultWorn(manifest);
        // the full kit DOES cover the hair (so the bare head below is doing something)
        expect(wocWornHidesHair(manifest, full), key).toBe(true);
        expect(wocWornHidesHair(manifest, { ...full, head: null }), key).toBe(false);
        kits++;
      }
    }
    expect(kits).toBe(18);
  });

  it('an NPC with no authored look falls back to a stock rig, never to a class body', () => {
    expect(npcLookFor('no_such_npc')).toBeNull();
    expect(visualKeyFor(npc('no_such_npc'))).toBe('npc_villager');
  });
});

describe('npc held props', () => {
  it('every prop set has its attach row, and every NPC names a real set', () => {
    expect(Object.keys(NPC_PROP_ATTACH).sort()).toEqual([...NPC_PROP_SET_IDS].sort());
    const unknown = roster.filter(([, def]) => !NPC_PROP_SET_IDS.includes(def.props));
    expect(unknown.map(([id]) => id)).toEqual([]);
  });

  // What each set puts in which hand, as literals: the table is the only place that says
  // a chronicler holds a staff AND a book, or that the shield rides the left arm.
  it('holds each prop set in the hands the cast was authored with', () => {
    const W = 'models/weapons';
    expect(NPC_PROP_ATTACH).toEqual({
      none: [],
      staff: [{ url: `${W}/staff_rare_a_teal.glb`, bone: 'handslot.r' }],
      walking_staff: [{ url: `${W}/brasscrown_walking_staff.glb`, bone: 'handslot.r' }],
      oak_stave: [{ url: `${W}/knotted_oak_stave.glb`, bone: 'handslot.r' }],
      tome: [
        { url: `${W}/staff_rare_b_violet.glb`, bone: 'handslot.r' },
        { url: `${W}/spellbook_starter.glb`, bone: 'handslot.l', rotationY: Math.PI },
      ],
      crossbow: [{ url: `${W}/crossbow_starter.glb`, bone: 'handslot.r' }],
      hammer: [{ url: `${W}/hammer_rare_b_ember.glb`, bone: 'handslot.r' }],
      woodaxe: [{ url: `${W}/notched_woodaxe.glb`, bone: 'handslot.r' }],
      sword_shield: [
        { url: `${W}/sword_rare_a_teal.glb`, bone: 'handslot.r' },
        { url: `${W}/shield_rare_a_teal.glb`, bone: 'handslot.l' },
      ],
      sword: [{ url: `${W}/sword_rare_b_teal.glb`, bone: 'handslot.r' }],
      scythe: [{ url: `${W}/spear_rare_a_teal.glb`, bone: 'handslot.r' }],
      knife: [{ url: `${W}/whittler_s_knife.glb`, bone: 'handslot.r' }],
      spear: [{ url: `${W}/spear_rare_b_ember.glb`, bone: 'handslot.r' }],
    });
  });

  // No world NPC holds a kit weapon: every generic prop is one of the pack's own models
  // (the rare set, or the starter crossbow and book, which have no rare counterpart).
  it('holds only pack models and the named props, never a kit weapon', () => {
    const named = new Set([
      'brasscrown_walking_staff',
      'knotted_oak_stave',
      'notched_woodaxe',
      'whittler_s_knife',
    ]);
    for (const [propSet, attach] of Object.entries(NPC_PROP_ATTACH)) {
      for (const a of attach) {
        const key = /([^/]+)\.glb$/.exec(a.url)?.[1] ?? '';
        const pack = /_rare_[ab]_(teal|ember|violet)$/.test(key) || key.endsWith('_starter');
        expect(pack || named.has(key), `${propSet}: ${key}`).toBe(true);
      }
    }
  });

  // An NPC rides a player class's def, whose own hands hold that class's weapons in swap
  // slots. Its props must REPLACE those hands: no slot left for a default weapon to fill.
  it('hands a body an override of fixed attaches with no swap slot', () => {
    for (const propSet of NPC_PROP_SET_IDS) {
      const hands = npcHeldProps(propSet);
      expect(hands.attach, propSet).toEqual(NPC_PROP_ATTACH[propSet]);
      expect(hands.weaponSlots, propSet).toBeUndefined();
      expect(hands.offhandSlot, propSet).toBeUndefined();
      // one object per set: every body that holds it shares the layout
      expect(npcHeldProps(propSet)).toBe(hands);
    }
  });

  // characterPreloadUrls is the set the boot gate is cut from (it ignores its tier
  // argument on purpose: the union of every tier). assets.ts then takes the Armory
  // weapon-skin models out of the gate and streams them on demand, and one NPC prop IS
  // such a model: the body that holds it builds fail-soft once the file lands, as the
  // composed body before it did. Pinned as a literal so a second one is a decision.
  it('names every prop for the boot gate, and knows the one that streams as a weapon skin', () => {
    const named = new Set(characterPreloadUrls(false));
    const props = [
      ...new Set(Object.values(NPC_PROP_ATTACH).flatMap((list) => list.map((a) => a.url))),
    ];
    expect(props.length).toBeGreaterThanOrEqual(12);
    for (const url of props) expect(named.has(url), url).toBe(true);
    const skins = new Set(weaponSkinModelUrls());
    expect(props.filter((url) => skins.has(url))).toEqual([
      'models/weapons/brasscrown_walking_staff.glb',
    ]);
  });

  // A prop on a bone the rig lacks ships the body without it, silently (assets.ts).
  it('every bone a prop rides exists on both WOC bodies', () => {
    const bones = new Set(
      Object.values(NPC_PROP_ATTACH).flatMap((list) => list.map((a) => a.bone)),
    );
    for (const fit of ['male', 'female']) {
      const file = path.join(__dirname, `../public/models/chars/players/woc/base_${fit}.glb`);
      const json = glbJsonChunk(readFileSync(file)) as { nodes: { name?: string }[] };
      const names = new Set(json.nodes.map((n) => n.name));
      for (const bone of bones) expect(names.has(bone), `${fit}: ${bone}`).toBe(true);
    }
  });
});

describe('the cast', () => {
  // Harbormaster Tamsin wore a tricorne, a pipe and a spyglass built for the old head
  // and hip bones. No NPC wears headgear now, and she is a creator character like the
  // rest of the cast: the navy coat (the mage kit), a salt-grey braid and a squint.
  it('keeps Harbormaster Tamsin a creator character: no worn gear', () => {
    const look = npcLookFor('harbormaster_tamsin');
    expect(look).not.toBeNull();
    if (!look) return;
    expect(look.cls).toBe('mage');
    expect(look.props).toBe('none');
    expect(look.app.gender).toBe('female');
    expect(look.app.headHair).toBe('braid');
    expect(look.app.hairSat).toBeLessThanOrEqual(0.15);
    expect(look.app.hairLight).toBeGreaterThanOrEqual(0.45);
    expect(look.app.headShape.eyeSize).toBeLessThan(0);
  });

  // The props are things a hand holds. A prop on any other bone would be worn gear,
  // authored for one body's proportions and wrong on every other.
  it('every prop rides a hand slot', () => {
    for (const [propSet, attach] of Object.entries(NPC_PROP_ATTACH)) {
      for (const a of attach) expect(a.bone, propSet).toMatch(/^handslot\.[lr]$/);
    }
  });

  it('keeps the Pale Keeper a pale priestess (the renderer draws her as a spirit)', () => {
    const look = npcLookFor('spirit_healer');
    expect(look?.cls).toBe('priest');
    expect(look?.app.gender).toBe('female');
    expect(look?.app.skinLight).toBeGreaterThan(0.85);
    // white hair: the new hair draws a stored value brighter, so 0.7 is already white
    expect(look?.app.hairSat).toBeLessThanOrEqual(0.1);
    expect(look?.app.hairLight).toBeGreaterThanOrEqual(0.65);
  });
});
