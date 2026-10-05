// The WOC head builder's catalog (src/render/characters/woc_head_catalog.ts):
// the node-naming contract with the head packs, the look resolver and the
// visible-node rule. The shipped-pack arm reads each GLB's own JSON chunk, so a
// renamed or missing piece fails here instead of silently drawing no nose.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveWocHeadLook,
  WOC_HEAD_SLOTS,
  WOC_HEAD_TYPES,
  WOC_PIERCING_PRESETS,
  type WocHeadSlot,
  type WocHeadType,
  wocHeadAllNodes,
  wocHeadAllUrls,
  wocHeadTintRole,
  wocHeadTypeForGender,
  wocHeadVariantNodes,
  wocHeadVisibleNodes,
} from '../src/render/characters/woc_head_catalog';
import { en } from '../src/ui/i18n.catalog';

const TYPES: WocHeadType[] = ['a', 'b'];

/** The node names under the `head` node of a shipped pack (GLB JSON chunk). */
function packHeadChildren(url: string): string[] | null {
  const file = `public/${url}`;
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: { name?: string; children?: number[] }[];
  };
  const head = json.nodes.find((n) => n.name === 'head');
  return (head?.children ?? []).map((i) => json.nodes[i].name ?? '');
}

describe('woc head catalog', () => {
  it('maps the body pick onto the head type', () => {
    expect(wocHeadTypeForGender('female')).toBe('b');
    expect(wocHeadTypeForGender('male')).toBe('a');
    expect(wocHeadTypeForGender(undefined)).toBe('a');
    expect(wocHeadTypeForGender('junk')).toBe('a');
  });

  it('names centred, paired and bald variants by the export contract', () => {
    expect(wocHeadVariantNodes('a', 'nose', 'broad')).toEqual(['WocHead_A_nose_broad']);
    expect(wocHeadVariantNodes('b', 'ears', 'round')).toEqual([
      'WocHead_B_ears_round_L',
      'WocHead_B_ears_round_R',
    ]);
    expect(wocHeadVariantNodes('a', 'hair', 'bald')).toEqual([]);
    // facial hair is a centred piece; clean shaven draws nothing on either type
    expect(wocHeadVariantNodes('a', 'beard', 'boxed')).toEqual(['WocHead_A_beard_boxed']);
    expect(wocHeadVariantNodes('b', 'beard', 'goatee')).toEqual(['WocHead_B_beard_goatee']);
    expect(wocHeadVariantNodes('a', 'beard', 'none')).toEqual([]);
    expect(wocHeadVariantNodes('b', 'beard', 'none')).toEqual([]);
  });

  it.each(TYPES)('maps every Type %s variant of every slot onto its own nodes', (type) => {
    const PAIRED: ReadonlySet<WocHeadSlot> = new Set<WocHeadSlot>(['brows', 'ears', 'eyes']);
    const letter = type.toUpperCase();
    const seen = new Set<string>();
    for (const slot of WOC_HEAD_SLOTS) {
      const variants = WOC_HEAD_TYPES[type].slots[slot];
      expect(variants.length, `${type}.${slot}`).toBeGreaterThan(0);
      for (const { id } of variants) {
        const nodes = wocHeadVariantNodes(type, slot, id);
        // the two "nothing worn" ids draw no mesh at all
        if ((slot === 'hair' && id === 'bald') || (slot === 'beard' && id === 'none')) {
          expect(nodes, `${type}.${slot}.${id}`).toEqual([]);
          continue;
        }
        const stem = `WocHead_${letter}_${slot}_${id}`;
        expect(nodes, `${type}.${slot}.${id}`).toEqual(
          PAIRED.has(slot) ? [`${stem}_L`, `${stem}_R`] : [stem],
        );
        // no two variants share a node (a shared node would draw both at once)
        for (const n of nodes) {
          expect(seen.has(n), `${n} named twice`).toBe(false);
          seen.add(n);
        }
      }
    }
  });

  it('offers facial hair on both head types, clean shaven first', () => {
    for (const type of TYPES) {
      const ids = WOC_HEAD_TYPES[type].slots.beard.map((v) => v.id);
      expect(ids[0]).toBe('none');
      expect(ids).toContain(WOC_HEAD_TYPES[type].defaults.beard);
      expect(ids.length).toBeGreaterThan(1);
    }
    // the authoring files' own openings: Type A bearded, Type B clean shaven
    expect(WOC_HEAD_TYPES.a.defaults.beard).not.toBe('none');
    expect(WOC_HEAD_TYPES.b.defaults.beard).toBe('none');
  });

  it('falls back per slot to the type default for another type or junk', () => {
    // Type A's hairstyle on a Type B body, a junk nose, an unknown piercing
    const look = resolveWocHeadLook('b', { hair: 'swept', nose: 'zzz', piercing: 'bogus' });
    expect(look.hair).toBe(WOC_HEAD_TYPES.b.defaults.hair);
    expect(look.nose).toBe(WOC_HEAD_TYPES.b.defaults.nose);
    expect(look.piercing).toBe('none');
    // a valid pick is kept
    expect(resolveWocHeadLook('a', { hair: 'mohawk' }).hair).toBe('mohawk');
    expect(resolveWocHeadLook('a', null)).toEqual(WOC_HEAD_TYPES.a.defaults);
  });

  it('never takes an inherited object name for a real id', () => {
    // Every one of these passes the appearance sanitizer's id pattern, so another
    // player's look can carry it. None is a preset: resolving one as if it were
    // handed the draw loop a non-list and threw in every client that saw the body.
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      for (const type of ['a', 'b'] as const) {
        const junk = {
          hair: id,
          beard: id,
          nose: id,
          mouth: id,
          brows: id,
          ears: id,
          eyes: id,
          piercing: id,
        };
        expect(resolveWocHeadLook(type, junk), `${type} ${id}`).toEqual(
          WOC_HEAD_TYPES[type].defaults,
        );
        expect(wocHeadVisibleNodes(type, junk, { helm: false }), `${type} ${id}`).toEqual(
          wocHeadVisibleNodes(type, null, { helm: false }),
        );
      }
    }
  });

  it('draws the base, one variant per slot and the piercing preset sites', () => {
    const nodes = wocHeadVisibleNodes('a', { hair: 'long', piercing: 'lobes' }, { helm: false });
    expect(nodes).toContain('WocHead_A_base');
    expect(nodes).toContain('WocHead_A_hair_long');
    expect(nodes).not.toContain('WocHead_A_hair_swept');
    expect(nodes).toContain('WocHead_A_piercing_lobe_l');
    expect(nodes).toContain('WocHead_A_piercing_lobe_r');
    expect(nodes).not.toContain('WocHead_A_piercing_lip');
    for (const slot of WOC_HEAD_SLOTS) {
      if (slot === 'hair') continue;
      expect(nodes.some((n) => n.startsWith(`WocHead_A_${slot}_`))).toBe(true);
    }
  });

  it('hides only the hair under a helm', () => {
    const bare = wocHeadVisibleNodes('a', { hair: 'long' }, { helm: false });
    const helm = wocHeadVisibleNodes('a', { hair: 'long' }, { helm: true });
    expect(helm).not.toContain('WocHead_A_hair_long');
    expect(bare.filter((n) => !n.includes('_hair_'))).toEqual(helm);
    // the beard stays under a helm (the face and facial hair show below it)
    const beard = wocHeadVisibleNodes('a', { hair: 'long', beard: 'long' }, { helm: true });
    expect(beard).toContain('WocHead_A_beard_long');
  });

  it('draws the worn beard and nothing for clean shaven', () => {
    const boxed = wocHeadVisibleNodes('b', { beard: 'boxed' }, { helm: false });
    expect(boxed).toContain('WocHead_B_beard_boxed');
    const none = wocHeadVisibleNodes('b', { beard: 'none' }, { helm: false });
    expect(none.some((n) => n.includes('_beard_'))).toBe(false);
    // Type B's own default is clean shaven
    const def = wocHeadVisibleNodes('b', null, { helm: false });
    expect(def.some((n) => n.includes('_beard_'))).toBe(false);
  });

  it('reads the tint role from a material name prefix', () => {
    expect(wocHeadTintRole('skin_head')).toBe('skin');
    expect(wocHeadTintRole('brow_L')).toBe('brow');
    expect(wocHeadTintRole('eye_R')).toBe('eye');
    expect(wocHeadTintRole('hair_mohawk')).toBe('hair');
    expect(wocHeadTintRole('metal_gold')).toBe('metal');
    expect(wocHeadTintRole('Material.001')).toBeNull();
  });

  it('every preset names real sites', () => {
    const all = new Set(wocHeadAllNodes('a'));
    for (const sites of Object.values(WOC_PIERCING_PRESETS)) {
      for (const site of sites) expect(all.has(`WocHead_A_piercing_${site}`)).toBe(true);
    }
  });

  it('names every type, slot variant and label in the English catalog', () => {
    // The builder renders these through t(); a key the catalog lacks shows the
    // raw key to the player. Walk the real nested English table.
    const lookup = (key: string): unknown => {
      let node: unknown = en;
      for (const part of key.split('.')) {
        if (typeof node !== 'object' || node === null) return undefined;
        node = (node as Record<string, unknown>)[part];
      }
      return node;
    };
    const missing: string[] = [];
    for (const type of TYPES) {
      const def = WOC_HEAD_TYPES[type];
      if (typeof lookup(def.labelKey) !== 'string') missing.push(def.labelKey);
      for (const slot of WOC_HEAD_SLOTS) {
        for (const v of def.slots[slot]) {
          if (typeof lookup(v.labelKey) !== 'string') missing.push(v.labelKey);
        }
      }
    }
    expect([...new Set(missing)], `labels missing from the English catalog`).toEqual([]);
  });

  it.each(TYPES)(
    'the shipped Type %s split files carry every catalog node on the head bone',
    (type) => {
      // the library ships split (wocHeadAllUrls): every file present, their union the catalog
      const files = wocHeadAllUrls(type).map((url) => [url, packHeadChildren(url)] as const);
      if (files.every(([, children]) => children === null)) return; // not exported yet
      expect(files.filter(([, children]) => children === null).map(([url]) => url)).toEqual([]);
      const shipped = files.flatMap(([, children]) => children ?? []);
      const missing = wocHeadAllNodes(type).filter((n) => !shipped.includes(n));
      expect(missing).toEqual([]);
    },
  );
});
