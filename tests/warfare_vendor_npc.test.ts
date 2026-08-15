// Warmarshal Draven Kole, the Highwatch WARFARE quartermaster (phase 4 of the
// WARFARE tier refactor).
//
// Three things can go wrong with this NPC and none of them is visible in a diff:
// he can perturb the deterministic world build (the whole reason for the
// `dynamic: true` + reserved-id pair), he can stand somewhere that silently
// deletes a piece of town furniture, or he can ship as an untinted villager
// because the NPC model map's fallback is silent. One block each.

import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { type Collider, queryOpenWorldColliders } from '../src/sim/colliders';
import { STATIONS } from '../src/sim/content/professions';
import { FURY_ENTITY_ID, FURY_NPC, FURY_NPC_ID, FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ZONE3_NPCS, ZONE3_ZONE } from '../src/sim/content/zone3';
import { BUILTIN_WORLD, ITEMS, NPCS, PROPS, setActiveWorldContent } from '../src/sim/data';
import { GRAVE_COUNT, GRAVE_RADIUS, graveOffset } from '../src/sim/prop_layout';
import {
  spawnWarfareQuartermaster,
  WARFARE_QUARTERMASTER_ENTITY_ID,
  WARFARE_QUARTERMASTER_NPC_ID,
} from '../src/sim/pvp/warfare_quartermaster';
import { Sim } from '../src/sim/sim';
import { VALE_CUP_BRAM_ID } from '../src/sim/social/vale_cup';
import { townPropPlacements } from '../src/sim/town_props';
import { STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { worldEntityText } from '../src/ui/world_entity_i18n';

const SEED = 42;
const KOLE = ZONE3_NPCS[WARFARE_QUARTERMASTER_NPC_ID];

describe('Warmarshal Draven Kole: the definition', () => {
  it('is a Highwatch NPC with the authored name, title and rank', () => {
    expect(KOLE).toBeDefined();
    expect(KOLE.id).toBe('warmarshal_draven_kole');
    expect(KOLE.name).toBe('Warmarshal Draven Kole');
    expect(KOLE.title).toBe('Master of the Warfare Stores');
    expect(KOLE.greeting).toBeTruthy();
    // The Highwatch copy trap: a neighbouring greeting carries an em dash and
    // the repo bans them outright.
    for (const text of [KOLE.name, KOLE.title, KOLE.greeting ?? '']) {
      // Written as escapes, not literals: the repo's pre-push copy scan greps the
      // push diff for these characters, so spelling them out here would make this
      // assertion block its own push.
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
    // Merged into the live table under the same key the spawn resolves.
    expect(NPCS[WARFARE_QUARTERMASTER_NPC_ID]).toBe(KOLE);
  });

  it('sells the one canonical WARFARE stock rather than a second copy of it', () => {
    // One list, two placements. FURY keeps the identical stock in Eastbrook, so
    // a divergence here means someone forked the item table.
    expect(KOLE.vendorItems).toEqual([...FURY_STOCK]);
    expect(NPCS[FURY_NPC_ID].vendorItems).toEqual([...FURY_STOCK]);
    expect(FURY_STOCK.length).toBeGreaterThan(0);
  });

  it('carries the warfareVendor flag on BOTH placements, so the shop is not Highwatch-only', () => {
    // The flag routes the sectioned shop WINDOW (isWarfareVendorNpc). Without it
    // an NPC silently falls back to the flat vendor grid, which still sells the
    // whole stock for honor, so a dropped flag is invisible except as a worse
    // window. FURY is the Eastbrook mirror of the identical stock and must
    // present identically; nothing else asserted either flag.
    expect(KOLE.warfareVendor, 'Warmarshal Draven Kole').toBe(true);
    expect(FURY_NPC.warfareVendor, 'FURY, the Eastbrook mirror').toBe(true);
    // And the two really do sell the same list, not a copy that can drift.
    expect(KOLE.vendorItems).toEqual(FURY_NPC.vendorItems);
    expect(KOLE.vendorItems).toEqual([...FURY_STOCK]);
  });

  it('is an honor vendor purely by virtue of its priced stock, not by a flag', () => {
    // There is no honor-vendor flag: the buy path, range gate, balance debit and
    // gossip row are all generic over a non-empty vendorItems whose entries carry
    // priceHonor. The warfareVendor flag above is a WINDOW routing hint only and
    // is never read by the purchase path. Pin that, and pin that he did NOT pick
    // up the id-keyed heroic vendor flag by accident.
    expect(KOLE.heroicVendor).toBeUndefined();
    expect(KOLE.market).toBeUndefined();
    expect(KOLE.banker).toBeUndefined();
    for (const itemId of KOLE.vendorItems ?? []) {
      const item = ITEMS[itemId];
      expect(item, itemId).toBeDefined();
      // The progression pin: every vendor row must carry a purchase price.
      expect(item.priceHonor ?? 0, itemId).toBeGreaterThan(0);
    }
  });

  it('reserves the next free singleton entity id and opts out of the generic loop', () => {
    // Both halves are required. Either one alone moves the id sequence.
    expect(KOLE.dynamic).toBe(true);
    expect(WARFARE_QUARTERMASTER_ENTITY_ID).toBe(1_000_000_002);
    expect(VALE_CUP_BRAM_ID).toBe(1_000_000_000);
    expect(FURY_ENTITY_ID).toBe(1_000_000_001);
    expect(new Set([VALE_CUP_BRAM_ID, FURY_ENTITY_ID, WARFARE_QUARTERMASTER_ENTITY_ID]).size).toBe(
      3,
    );
    // Still below the static world-service band, which owns everything above it.
    expect(WARFARE_QUARTERMASTER_ENTITY_ID).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
  });
});

describe('Warmarshal Draven Kole: the world build is untouched', () => {
  it('moves neither the entity ids, the id counter, nor the rng stream', () => {
    // The regression this whole reservation exists for. Build the world twice,
    // once with the def deleted, and assert the two are indistinguishable apart
    // from the reserved entity itself. A failure here is a defect in the
    // implementation, not a golden to re-mint: the parity replays pin nextId per
    // frame and every ctor-spawned id would shift with it.
    const npcsWithout = { ...BUILTIN_WORLD.npcs };
    delete npcsWithout[WARFARE_QUARTERMASTER_NPC_ID];
    const worldWithout = { ...BUILTIN_WORLD, npcs: npcsWithout };

    setActiveWorldContent(worldWithout);
    const without = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: worldWithout,
    });
    setActiveWorldContent(BUILTIN_WORLD);
    const with_ = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });

    expect(without.entities.has(WARFARE_QUARTERMASTER_ENTITY_ID)).toBe(false);
    expect(with_.entities.has(WARFARE_QUARTERMASTER_ENTITY_ID)).toBe(true);
    expect(
      [...with_.entities.keys()].filter((id) => id !== WARFARE_QUARTERMASTER_ENTITY_ID),
    ).toEqual([...without.entities.keys()]);
    expect(with_.nextId).toBe(without.nextId);
    expect(with_.rng.next()).toBe(without.rng.next());
  });

  it('spawns him on the ground at his authored spot, facing what he was authored to face', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const kole = sim.entities.get(WARFARE_QUARTERMASTER_ENTITY_ID);
    if (!kole) throw new Error('missing reserved WARFARE quartermaster entity');
    expect(kole.kind).toBe('npc');
    expect(kole.templateId).toBe('warmarshal_draven_kole');
    // findSafePos is pure geometry and does not nudge a clear authored point.
    expect(kole.pos.x).toBe(KOLE.pos.x);
    expect(kole.pos.z).toBe(KOLE.pos.z);
    expect(kole.spawnPos.x).toBe(KOLE.pos.x);
    expect(kole.spawnPos.z).toBe(KOLE.pos.z);
    expect(kole.facing).toBe(KOLE.facing);
    expect(kole.vendorItems).toEqual([...FURY_STOCK]);
  });

  it('is idempotent, so a second spawn call cannot mint a duplicate', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const before = sim.entities.size;
    const nextIdBefore = sim.nextId;
    spawnWarfareQuartermaster(
      (sim as unknown as { ctx: Parameters<typeof spawnWarfareQuartermaster>[0] }).ctx,
      KOLE,
      { x: KOLE.pos.x, z: KOLE.pos.z },
    );
    expect(sim.entities.size).toBe(before);
    expect(sim.nextId).toBe(nextIdBefore);
  });
});

describe('Warmarshal Draven Kole: the placement clears all three suites', () => {
  it('stands inside the Highwatch hub, in the quartermaster row but not on Vex', () => {
    const hub = ZONE3_ZONE.hub;
    const fromHub = Math.hypot(KOLE.pos.x - hub.x, KOLE.pos.z - hub.z);
    expect(fromHub).toBeLessThan(hub.radius);
    // Inside the zone band and the world rect (the progression pin).
    expect(KOLE.pos.z).toBeGreaterThanOrEqual(ZONE3_ZONE.zMin);
    expect(KOLE.pos.z).toBeLessThan(ZONE3_ZONE.zMax);

    const vex = NPCS.heroic_quartermaster.pos;
    const toVex = Math.hypot(KOLE.pos.x - vex.x, KOLE.pos.z - vex.z);
    // NOT Vex's exact coordinates (what a naive "next to Vex" produces), and
    // inside the four-to-six yard spacing the rest of the row already runs at.
    expect(toVex).toBeGreaterThanOrEqual(4);
    expect(toVex).toBeLessThanOrEqual(6);

    // And clear of everyone else: no other authored NPC is closer than the row's
    // own spacing floor.
    for (const npc of Object.values(NPCS)) {
      if (npc.id === KOLE.id) continue;
      const d = Math.hypot(npc.pos.x - KOLE.pos.x, npc.pos.z - KOLE.pos.z);
      expect(d, `${npc.id} is on top of the Warmarshal`).toBeGreaterThanOrEqual(4);
    }
  });

  it('does not sit inside a solid collider at the AUTHORED point', () => {
    // Mirrors the physics sweep exactly: it tests the authored position, not the
    // safe-position-nudged one, and its allowlist must not be extended.
    const cols: Collider[] = [];
    queryOpenWorldColliders(SEED, -60, 620, 60, 700, cols);
    expect(cols.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const c of cols) {
      if (c.moveTopY !== undefined && c.moveTopY - groundHeight(c.x, c.z, SEED) <= 0.9) continue;
      const hit =
        c.type === 'circle'
          ? Math.hypot(KOLE.pos.x - c.x, KOLE.pos.z - c.z) < c.r - 0.05
          : (() => {
              const cos = Math.cos(-c.rot);
              const sin = Math.sin(-c.rot);
              const lx = (KOLE.pos.x - c.x) * cos + (KOLE.pos.z - c.z) * sin;
              const lz = -(KOLE.pos.x - c.x) * sin + (KOLE.pos.z - c.z) * cos;
              return Math.abs(lx) < c.hw - 0.05 && Math.abs(lz) < c.hd - 0.05;
            })();
      if (hit) hits.push(`(${c.x.toFixed(1)},${c.z.toFixed(1)})`);
    }
    expect(hits).toEqual([]);
  });

  it('vetoes no station prop and no graveyard headstone out of existence', () => {
    // Town collision treats EVERY town NPC, dynamic or not, as a veto spot: a
    // prop or headstone inside the clearance silently stops existing in both the
    // sim colliders and the renderer. Placing him must delete nothing.
    const anchors = STATIONS.map((st) => ({ type: st.type, x: st.pos.x, z: st.pos.z }));
    const npcPositions = (extra: boolean) => {
      const out: { x: number; z: number }[] = [];
      for (const npc of Object.values(NPCS)) {
        if (!extra && npc.id === KOLE.id) continue;
        out.push({ x: npc.pos.x, z: npc.pos.z });
      }
      return out;
    };
    const withKole = townPropPlacements(anchors, npcPositions(true));
    const withoutKole = townPropPlacements(anchors, npcPositions(false));
    expect(withKole).toEqual(withoutKole);
    expect(withKole.length).toBeGreaterThan(10);

    // The headstone half of the same rule (colliders.ts applies it per stone).
    for (const gy of PROPS.graveyards) {
      for (let i = 0; i < GRAVE_COUNT; i++) {
        const off = graveOffset(i);
        const d = Math.hypot(gy.x + off.x - KOLE.pos.x, gy.z + off.z - KOLE.pos.z);
        expect(d, `headstone ${i} of graveyard ${gy.x},${gy.z}`).toBeGreaterThan(
          GRAVE_RADIUS + 0.4,
        );
      }
    }
  });

  it('takes a tint the visual manifest has not reserved for another identity', () => {
    const reserved = [
      NPCS.bursar_petra_vell.color,
      NPCS.bursar_aldous_crane.color,
      NPCS.auctioneer_voss.color,
      NPCS.chronicler_saul.color,
      NPCS.chronicler_osric_fenn.color,
      NPCS.chronicler_edda_hartwell.color,
    ];
    expect(reserved).not.toContain(KOLE.color);
    // And distinct from the Eastbrook mirror, so the two read as two people.
    expect(KOLE.color).not.toBe(NPCS[FURY_NPC_ID].color);
  });
});

describe('Warmarshal Draven Kole: presentation registrations', () => {
  it('renders as the armored knight, and drags FURY off the villager fallback with him', () => {
    // The NPC model map's fallback is SILENT: an unmapped id resolves to the
    // tinted villager body and no other test asserts a row exists. That is
    // exactly how both WARFARE vendors ended up looking like townsfolk.
    for (const templateId of [WARFARE_QUARTERMASTER_NPC_ID, FURY_NPC_ID]) {
      const key = visualKeyFor({ kind: 'npc', templateId } as never);
      expect(key, templateId).toBe('npc_knight');
      expect(key, templateId).not.toBe('npc_villager');
    }
    // An existing armored visual, reused: no new asset, so no clipmap obligation.
    expect(VISUALS.npc_knight.url).toBe('models/chars/players/knight.glb');
    expect(VISUALS.npc_knight.show).toEqual(['Knight_Helmet', 'Knight_Cape']);
  });

  it('resolves its greeting to a declared voice', async () => {
    // A greeting with no voice entry fails tests/npc_voice_coverage.test.ts
    // outright. The alias is the keyless route; the rendered clip is a separate
    // key-gated script, so he ships mute until the maintainer renders him.
    const { VOICE_ALIAS, VOICE_PROMPTS, voiceIdFor } = await import(
      '../scripts/voices/npc_voice_prompts.mjs'
    );
    const voice = voiceIdFor(WARFARE_QUARTERMASTER_NPC_ID);
    expect(voice).toBe(FURY_NPC_ID);
    expect((VOICE_PROMPTS as { npcId: string }[]).map((p) => p.npcId)).toContain(voice);
    // An alias must never point at another alias.
    expect(Object.hasOwn(VOICE_ALIAS as Record<string, string>, voice)).toBe(false);
  });

  it('is registered as a localizable world entity, sourced off the NpcDef itself', () => {
    // Registration is one id appended to the world-entity id list; there is no
    // hand-written English catalog entry because the English is pulled off the
    // def (and that module throws at load on a listed id with no table row).
    const npcs = worldEntityText.en.entities.npcs as Record<
      string,
      { name: string; title: string; greeting: string }
    >;
    const entry = npcs[WARFARE_QUARTERMASTER_NPC_ID];
    expect(entry).toBeDefined();
    expect(entry.name).toBe(KOLE.name);
    expect(entry.title).toBe(KOLE.title);
    expect(entry.greeting).toBe(KOLE.greeting);
  });
});
