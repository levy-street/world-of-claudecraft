import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GUIDE_FAMILIES,
  GUIDE_NPCS,
  GUIDE_PROF_CRAFTS,
  GUIDE_PROF_ENCHANTING,
  GUIDE_PROF_MATERIALS,
} from '../src/guide/content.generated';
import { npcs as npcsPage, npcTitleKey } from '../src/guide/pages/npcs';
import { professions as professionsPage } from '../src/guide/pages/professions';
import {
  materialAnchor,
  materialSourceHtml,
  npcAnchor,
} from '../src/guide/pages/professions_materials';
import { GUIDE_ROUTES } from '../src/guide/routes';
import { buildIndex } from '../src/guide/search';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FACTION_VENDOR_GATES } from '../src/sim/content/faction_vendors';
import {
  CRUCIBLE_VENDOR_ENTRANCE_POS,
  CRUCIBLE_VENDOR_NPC_ID,
  CRUCIBLE_VENDOR_STOCK,
} from '../src/sim/content/ignivar_loot';
import { HARVEST_COMPONENT_SPECIMENS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { DUNGEON_X_THRESHOLD, MOBS, NPCS, ZONES } from '../src/sim/data';
import { COMPASS_ROSE_IDS } from '../src/ui/compass';
import { esc } from '../src/ui/esc';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

// The professions "where do I get it" surfaces: the named Source cells, the
// Materials page, and NPC Locations. Every pin reads the LIVE tables, so these
// assert that the generated pages tell a player the truth about the game today.
// The derivation's own semantics are pinned on synthetic tables in
// tests/wiki_acquisition_sources.test.ts.

const ctx = (sub: string, params: string[] = []) => ({
  params,
  sub,
  titleKey: 'guide.nav.professions' as const,
});

// Where the Sim stands an NPC at world start: its def position, except the
// Crucible Quartermaster (src/sim/sim.ts places him at the raid entrance).
const standingPos = (npcId: string): { x: number; z: number } =>
  npcId === CRUCIBLE_VENDOR_NPC_ID ? CRUCIBLE_VENDOR_ENTRANCE_POS : NPCS[npcId].pos;

const rowById = (html: string, id: string): string =>
  html.match(new RegExp(`<tr id="${id}">(?:(?!</tr>)[\\s\\S])*</tr>`))?.[0] ?? '';

describe('Guide professions sources, materials and NPC locations', () => {
  beforeAll(() => setLanguage('en'));

  it('lists every material a recipe or enchant bill uses, once, with at least one source', () => {
    const used = new Set<string>();
    for (const r of ALL_RECIPES) for (const g of r.reagents) used.add(g.itemId);
    for (const e of Object.values(ENCHANTS)) for (const g of e.reagents) used.add(g.itemId);
    const listed = GUIDE_PROF_MATERIALS.map((m) => m.itemId);
    expect(new Set(listed).size, 'no material is listed twice').toBe(listed.length);
    expect([...listed].sort()).toEqual([...used].sort());
    const sourceless = GUIDE_PROF_MATERIALS.filter((m) => m.sources.length === 0);
    expect(
      sourceless.map((m) => m.itemId),
      'every material must say where it comes from',
    ).toEqual([]);
  });

  it('names the Crucible Quartermaster, never the Heroic one, for its pattern stock', () => {
    // The regression this page fixed: the Crucible stock rode the Heroic
    // stock's channel, so every Crucible collection row told players to visit
    // the wrong vendor.
    const crucibleItems = new Set(CRUCIBLE_VENDOR_STOCK.map((o) => o.itemId));
    const rows = GUIDE_PROF_CRAFTS.flatMap((c) => c.recipes).filter((r) =>
      r.sources?.offers.some((o) => o.kind === 'crucible'),
    );
    expect(rows.length, 'the Crucible stock reaches the recipe tables').toBeGreaterThan(0);
    expect(crucibleItems.size).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        row.sources?.offers.some((o) => o.kind === 'heroic'),
        `${row.id} is not on the Heroic Quartermaster`,
      ).toBe(false);
    }
    // And the rendered cell says Crucible for one live row. Names are matched
    // escaped, as the page prints them (an apostrophe renders as an entity).
    const sample = rows[0];
    const craft = GUIDE_PROF_CRAFTS.find((c) => c.recipes.includes(sample));
    const html = professionsPage.render(ctx('professions', [craft?.id ?? '']));
    const name = esc(sample.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const row =
      html.match(
        new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*${name}(?:(?!</tr>)[\\s\\S])*</tr>`),
      )?.[0] ?? '';
    expect(row, 'the sample row renders').not.toBe('');
    expect(row).toContain('Crucible Quartermaster');
    expect(row).not.toContain(t('guide.profPages.sourceVendor'));
  });

  it('names the faction and standing for every pattern a faction quartermaster sells', () => {
    // The second regression: these were labelled "From a found pattern" though
    // nothing drops them.
    const factionRecipeIds = ALL_RECIPES.filter((r) => FACTION_VENDOR_GATES[r.id]).map((r) => r.id);
    expect(factionRecipeIds.length).toBeGreaterThan(0);
    const rows = GUIDE_PROF_CRAFTS.flatMap((c) => c.recipes);
    for (const id of factionRecipeIds) {
      const row = rows.find((r) => r.id === id);
      const gate = FACTION_VENDOR_GATES[id];
      expect(row?.sources?.offers, id).toContainEqual({
        kind: 'faction',
        factionId: gate.factionId ?? null,
        tier: gate.standingTier,
        marks: gate.currencyCost,
      });
    }
    const alchemy = professionsPage.render(ctx('professions', ['alchemy']));
    const manaRow =
      alchemy.match(
        /<tr[^>]*>(?:(?!<\/tr>)[\s\S])*Elixir of Mana Regeneration(?:(?!<\/tr>)[\s\S])*<\/tr>/,
      )?.[0] ?? '';
    expect(manaRow).toContain('Church Order');
    expect(manaRow).toContain(t('hudChrome.reputation.tier.proven'));
    expect(manaRow).not.toContain(t('guide.profPages.sourceDrop'));
  });

  it('says where every required enchanting formula comes from', () => {
    const formulas = GUIDE_PROF_ENCHANTING.enchants.filter((e) => e.requiresFormula);
    expect(formulas.length).toBeGreaterThan(0);
    for (const e of formulas) {
      const sources = e.formulaSources;
      expect(sources, e.id).toBeDefined();
      expect((sources?.drops.length ?? 0) + (sources?.offers.length ?? 0), e.id).toBeGreaterThan(0);
    }
  });

  it('renders the Materials page with a linked row per material', () => {
    const html = professionsPage.render(ctx('professions', ['materials']));
    expect(html.match(/<h1>/g)).toHaveLength(1);
    for (const m of GUIDE_PROF_MATERIALS) {
      expect(html, m.itemId).toContain(`id="${materialAnchor(m.itemId)}"`);
    }
    // Glyphsteel Bar is vendor-only: the row names its sellers and links each
    // one to its NPC Locations row, and that row exists.
    const bar = rowById(html, materialAnchor('arcanite_bar'));
    const npcHtml = npcsPage.render(ctx('npcs'));
    for (const id of ['quartermaster_bree', 'tinker_gizzel']) {
      expect(bar).toContain(`/wiki/npcs#${npcAnchor(id)}`);
      expect(npcHtml).toContain(`id="${npcAnchor(id)}"`);
    }
    expect(bar).toContain(NPCS.tinker_gizzel.name);
  });

  it('renders every source kind without a raw key or a stray placeholder', () => {
    const kinds = new Set<string>();
    for (const m of GUIDE_PROF_MATERIALS) {
      for (const s of m.sources) {
        kinds.add(s.kind);
        for (const line of materialSourceHtml(s)) {
          expect(line, `${m.itemId} ${s.kind}`).not.toMatch(/guide\.|\{[a-z]+\}|[\uE000\uE001]/);
          expect(line.length, `${m.itemId} ${s.kind}`).toBeGreaterThan(0);
        }
      }
    }
    // Non-vacuity: the live catalog exercises the main kinds.
    for (const kind of [
      'node',
      'corpse',
      'specimen',
      'farm',
      'fishing',
      'vendor',
      'crafted',
      'instanced',
    ]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('never names a boss on the Materials or NPC Locations page', () => {
    // The guide-wide withhold-the-name rule (tests/guide.test.ts holds it for
    // the generated file); the two new pages are held to it as rendered.
    const html =
      professionsPage.render(ctx('professions', ['materials'])) + npcsPage.render(ctx('npcs'));
    for (const boss of Object.values(MOBS).filter((m) => m.boss)) {
      const personal = boss.name.split(',')[0];
      expect(html.includes(personal), `boss name "${personal}" leaked`).toBe(false);
    }
  });

  it('names a carrier only when the bestiary already publishes that creature', () => {
    // Held to the bestiary rather than to the generator's own rule, so a widened
    // or narrowed rule in acquisition_sources.mjs cannot agree with itself: the
    // bestiary withholds elite, boss and world boss creatures and names the
    // rest (rares included), and a carrier the wiki names must be one of those.
    // An item can carry a creature's name ("Old Cragmaw's Pelt"), so this checks
    // the creature lists themselves, not a page scan.
    const published = new Set(GUIDE_FAMILIES.flatMap((f) => f.creatures.map((c) => c.name)));
    let named = 0;
    for (const m of GUIDE_PROF_MATERIALS) {
      for (const s of m.sources) {
        if (s.kind !== 'drop' && s.kind !== 'corpse') continue;
        for (const c of s.creatures) {
          named++;
          expect(published.has(c.name), `${m.itemId} names unpublished "${c.name}"`).toBe(true);
        }
      }
    }
    expect(named).toBeGreaterThan(0);
    // And the withheld side is real: some material is sourced from an elite,
    // stated by zone only.
    expect(
      GUIDE_PROF_MATERIALS.some((m) =>
        m.sources.some(
          (s) => s.kind === 'eliteDrop' || (s.kind === 'corpse' && (s.eliteZones?.length ?? 0) > 0),
        ),
      ),
    ).toBe(true);
  });

  it('states a premium specimen as a bonus on its base harvest, never its own carriers', () => {
    // Pristine Hide and kin come only with a rare-or-better harvest of the base
    // material (src/sim/content/professions.ts HARVEST_COMPONENT_SPECIMENS); a
    // creature list would read as a guaranteed harvest.
    const html = professionsPage.render(ctx('professions', ['materials']));
    const specimens = Object.values(HARVEST_COMPONENT_SPECIMENS).filter((id) =>
      GUIDE_PROF_MATERIALS.some((m) => m.itemId === id),
    );
    expect(specimens.length).toBeGreaterThan(0);
    for (const id of specimens) {
      const row = GUIDE_PROF_MATERIALS.find((m) => m.itemId === id);
      const specimen = row?.sources.find((s) => s.kind === 'specimen');
      expect(specimen, id).toBeDefined();
      expect(
        row?.sources.some((s) => s.kind === 'corpse'),
        `${id} lists no carriers`,
      ).toBe(false);
      if (specimen?.kind !== 'specimen') continue;
      // The base is a real listed material, and the row links to it.
      expect(GUIDE_PROF_MATERIALS.some((m) => m.itemId === specimen.baseItemId)).toBe(true);
      expect(rowById(html, materialAnchor(id))).toContain(
        `href="#${materialAnchor(specimen.baseItemId)}"`,
      );
    }
  });

  it('places every listed NPC where the live NPC table puts it', () => {
    expect(GUIDE_NPCS.length).toBeGreaterThan(50);
    // The Crucible Quartermaster is named by every Crucible pattern row, so he
    // must be findable: the Sim places him at the raid entrance at world start
    // (his def sits at the origin), and the directory follows the Sim.
    expect(GUIDE_NPCS.some((n) => n.id === CRUCIBLE_VENDOR_NPC_ID)).toBe(true);
    for (const n of GUIDE_NPCS) {
      const def = NPCS[n.id];
      expect(def, n.id).toBeDefined();
      const zone = ZONES.find((z) => z.id === n.zoneId);
      expect(zone, n.id).toBeDefined();
      if (!def || !zone) continue;
      expect(n.name).toBe(def.name);
      expect(n.town).toBe(zone.hub.name);
      const pos = standingPos(n.id);
      const distance = Math.hypot(pos.x - zone.hub.x, pos.z - zone.hub.z);
      if (distance <= zone.hub.radius) {
        expect(n.yards, `${n.id} is in town`).toBeUndefined();
      } else {
        expect(Math.abs((n.yards ?? 0) - distance), `${n.id} distance`).toBeLessThanOrEqual(10);
        expect(COMPASS_ROSE_IDS).toContain(n.direction);
      }
    }
  });

  it('leaves out event casts, origin-parked and instanced NPCs, and dev vendors', () => {
    const listed = new Set(GUIDE_NPCS.map((n) => n.id));
    // Literal exemplars of what must stay out: world quest casts that exist only
    // while their quest runs, and the raid's encounter NPCs.
    for (const id of [
      'shadow_guard_north',
      'infiltrator_nella',
      'calligraphy_apprentice_1',
      'brother_aldric_raid',
      'archivist_maelin_emberward',
      'spirit_healer',
    ]) {
      expect(NPCS[id], `${id} still exists`).toBeDefined();
      expect(listed.has(id), `${id} must not be listed`).toBe(false);
    }
    for (const n of GUIDE_NPCS) {
      const def = NPCS[n.id];
      expect(def?.devVendor, n.id).toBeFalsy();
      const pos = standingPos(n.id);
      expect(pos.x !== 0 || pos.z !== 0, `${n.id} is not parked at the origin`).toBe(true);
      expect(pos.x <= DUNGEON_X_THRESHOLD, `${n.id} is not on the instance plane`).toBe(true);
    }
    // And the service NPCs players look for are in: the WARFARE quartermaster
    // and the weekly emissary are dynamic but stand at fixed spots.
    expect(listed.has('warmarshal_draven_kole')).toBe(true);
    expect(listed.has('weekly_emissary')).toBe(true);
  });

  it('shows each NPC title in the reader language', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      const html = npcsPage.render(ctx('npcs'));
      const row = rowById(html, npcAnchor('cook_marlow'));
      const title = t(npcTitleKey('cook_marlow'));
      expect(title).not.toBe('entities.npcs.cook_marlow.title');
      expect(title).not.toBe(NPCS.cook_marlow.title);
      expect(row).toContain(esc(title));
    } finally {
      setLanguage('en');
    }
  });

  it('points the compass the way the HUD does: +Z is north, -X is east', () => {
    // facing 0 = +Z = north and turning right decreases facing (src/ui/compass.ts),
    // so a point due -X of town reads E. Checked on any live out-of-town NPC whose
    // offset is clearly along one axis.
    const checked = GUIDE_NPCS.filter((n) => n.yards !== undefined).flatMap((n) => {
      const def = NPCS[n.id];
      const zone = ZONES.find((z) => z.id === n.zoneId);
      if (!def || !zone) return [];
      const pos = standingPos(n.id);
      const dx = pos.x - zone.hub.x;
      const dz = pos.z - zone.hub.z;
      if (Math.abs(dx) > 3 * Math.abs(dz)) return [[n.direction, dx < 0 ? 'E' : 'W']];
      if (Math.abs(dz) > 3 * Math.abs(dx)) return [[n.direction, dz > 0 ? 'N' : 'S']];
      return [];
    });
    expect(checked.length).toBeGreaterThan(0);
    for (const [got, want] of checked) expect(got).toBe(want);
  });

  it('routes, indexes and maps the two new pages', () => {
    expect(GUIDE_ROUTES.some((r) => r.id === 'npcs' && r.sub === 'npcs')).toBe(true);
    const index = buildIndex();
    expect(
      index.some((e) => e.href === `/wiki/professions/materials#${materialAnchor('arcanite_bar')}`),
    ).toBe(true);
    const anyNpc = GUIDE_NPCS[0];
    expect(index.some((e) => e.href === `/wiki/npcs#${npcAnchor(anyNpc.id)}`)).toBe(true);
    const sitemap = readFileSync(join(process.cwd(), 'public', 'sitemap.xml'), 'utf8');
    expect(sitemap).toContain('/wiki/npcs</loc>');
    expect(sitemap).toContain('/wiki/professions/materials</loc>');
  });
});
