import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OpenAirFieldRoster, openAirFieldAt } from '../src/render/open_air_field_visibility_core';
import {
  DUNGEONS,
  dungeonAt,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  instanceSlotForZ,
} from '../src/sim/data';

const sourceOf = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The statements of a source slice, one trimmed line each, comments dropped:
 *  a wiring pin must not be satisfied by a call that is commented out. */
function statements(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

// The interiors built as open-air fields (the OPEN_AIR_FIELDS table, pinned
// to its source below so a new field joins every sweep here).
const OPEN_AIR_INTERIORS = [
  'wildheart',
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
];

const dungeonOf = (interior: string) => {
  const dungeon = Object.values(DUNGEONS).find((d) => d.interior === interior);
  if (!dungeon) throw new Error(`no dungeon builds the ${interior} interior`);
  return dungeon;
};

const origin = (interior: string, slot: number) => {
  const o = instanceOrigin(dungeonOf(interior).index, slot);
  return { ox: o.x, oz: o.z };
};

const root = (visible = true) => ({
  visible,
  position: {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  },
  userData: {} as Record<string, unknown>,
});

describe('openAirFieldAt (which built open-air field a position stands in)', () => {
  const sanctum = origin('gravewyrm_sanctum', 0);
  const temple = origin('drowned_temple', 0);

  it('sweeps every interior the open-air table builds', () => {
    const table = sourceOf('../src/render/open_air_fields.ts');
    const start = table.indexOf('export const OPEN_AIR_FIELDS');
    expect(start).toBeGreaterThan(-1);
    const keys = [...table.slice(start).matchAll(/^ {2}(\w+): build\w+Interior,$/gm)].map(
      (m) => m[1],
    );
    expect(keys.sort()).toEqual([...OPEN_AIR_INTERIORS].sort());
  });

  it('pins the layout the leak came from: the Sanctum and the Temple are neighbours', () => {
    // The Sanctum's cirque and its sky dome reach far past 600 yd, so a Sanctum
    // left drawn stood in the Temple's sky as shards under an aurora.
    expect(temple.ox - sanctum.ox).toBe(600);
    expect(temple.oz).toBe(sanctum.oz);
  });

  it('holds the Temple, never the Sanctum, at the Temple landing', () => {
    // The spot of the report: the arrival of a Temple run in the first slot.
    expect(openAirFieldAt([sanctum, temple], 102102, -1472)).toBe(1);
    expect(openAirFieldAt([temple, sanctum], 102102, -1472)).toBe(0);
  });

  it('holds the Sanctum, never the Temple, at the Sanctum landing', () => {
    expect(openAirFieldAt([sanctum, temple], 101500, -1472)).toBe(0);
    expect(openAirFieldAt([temple, sanctum], 101500, -1472)).toBe(1);
  });

  it('holds nothing in the overworld, a closed dungeon, the arena or a delve', () => {
    const fields = [sanctum, temple];
    expect(openAirFieldAt(fields, 0, 0)).toBe(-1);
    // Nythraxis' crypt, the band east of the Temple.
    expect(openAirFieldAt(fields, 102700, -1250)).toBe(-1);
    // The Ashen Coliseum and the delve band.
    expect(openAirFieldAt(fields, 103600, -1250)).toBe(-1);
    expect(openAirFieldAt(fields, 104200, -1250)).toBe(-1);
  });

  it('holds nothing while no field is built', () => {
    expect(openAirFieldAt([], 102102, -1472)).toBe(-1);
  });

  it('holds nothing in a slot whose own field is not built yet', () => {
    // A later run of the same dungeon in another slot: the first run's field
    // must not stand in for the one still building.
    const laterSlot = origin('drowned_temple', 5);
    expect(openAirFieldAt([temple], laterSlot.ox, laterSlot.oz)).toBe(-1);
    expect(openAirFieldAt([temple, laterSlot], laterSlot.ox, laterSlot.oz)).toBe(1);
  });

  it('prefers the newest of two fields built at one origin', () => {
    expect(openAirFieldAt([temple, { ...temple }], temple.ox, temple.oz)).toBe(1);
  });

  it('draws the same cells the instance plane files a body under', () => {
    // Every slot of every open-air dungeon, built: the field held at a point is
    // the instance dungeonAt and instanceSlotForZ put that point in, and nothing
    // anywhere else (the closed bands beside them included). Swept in both
    // build orders, so the scan's own order never picks the right cell for it.
    const built: { ox: number; oz: number }[] = [];
    for (const key of OPEN_AIR_INTERIORS) {
      for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) built.push(origin(key, slot));
    }
    const orders = [built, [...built].reverse()];
    const first = instanceOrigin(0, 0).z;
    const last = instanceOrigin(0, INSTANCE_SLOT_COUNT - 1).z;
    let held = 0;
    let unheld = 0;
    let heldOnSlotEdge = 0;
    let heldOnBandEdge = 0;
    for (const key of [...OPEN_AIR_INTERIORS, 'crypt', 'nythraxis']) {
      const band = instanceOrigin(dungeonOf(key).index, 0).x;
      // 300 is the next band's west edge, and belongs to it. The west edges of
      // the first band and of the overflow band are a single x the sim files
      // under no dungeon (dungeonAt) and a cell here keeps: unsampled.
      for (const dx of [-300.5, -299.5, -120, 0, 120, 299.5, 300, 300.5]) {
        for (let z = first - 400; z <= last + 400; z += 12.5) {
          const x = band + dx;
          const dungeon = dungeonAt(x);
          const cell = dungeon ? instanceOrigin(dungeon.index, instanceSlotForZ(z)) : null;
          // instanceSlotForZ clamps: past the last slot's cell no instance lives.
          const inPlane = z >= first - 250 && z < last + 250;
          const want =
            cell && inPlane && dungeon && OPEN_AIR_INTERIORS.includes(dungeon.interior)
              ? { ox: cell.x, oz: cell.z }
              : null;
          for (const order of orders) {
            const at = openAirFieldAt(order, x, z);
            expect(at < 0 ? null : order[at], `x ${x} z ${z}`).toEqual(want);
          }
          if (!want) {
            unheld++;
            continue;
          }
          held++;
          if (Math.abs(z - want.oz) === 250) heldOnSlotEdge++;
          if (Math.abs(x - want.ox) === 300) heldOnBandEdge++;
        }
      }
    }
    // The sweep really crossed every dungeon's cells (one alone holds a fifth
    // of these), the closed bands, and points lying exactly on a cell's edge.
    expect(held).toBeGreaterThan(30000);
    expect(unheld).toBeGreaterThan(1000);
    expect(heldOnSlotEdge).toBeGreaterThan(500);
    expect(heldOnBandEdge).toBeGreaterThan(2000);
  });
});

describe('OpenAirFieldRoster', () => {
  const sanctum = origin('gravewyrm_sanctum', 0);
  const temple = origin('drowned_temple', 0);

  it('anchors a built field at its slot origin and tags it as dungeon scenery', async () => {
    const roster = new OpenAirFieldRoster();
    const built = root();
    const seen: unknown[] = [];
    const group = await roster.build(
      (deps: { lowGfx: boolean }, ox: number, oz: number) => {
        seen.push(deps, ox, oz);
        return built;
      },
      { lowGfx: true },
      temple.ox,
      temple.oz,
    );
    expect(group).toBe(built);
    expect(seen).toEqual([{ lowGfx: true }, temple.ox, temple.oz]);
    expect([built.position.x, built.position.y, built.position.z]).toEqual([
      temple.ox,
      0,
      temple.oz,
    ]);
    expect(built.userData.renderCategory).toBe('dungeon');
  });

  it('syncs before any field is built', () => {
    expect(() => new OpenAirFieldRoster().sync(102102, -1472)).not.toThrow();
  });

  it('draws only the field the player stands in (the Sanctum left standing in the Temple)', async () => {
    const roster = new OpenAirFieldRoster();
    const sanctumRoot = await roster.build(async () => root(), null, sanctum.ox, sanctum.oz);
    roster.sync(sanctum.ox, sanctum.oz - 222);
    expect(sanctumRoot.visible).toBe(true);

    // On to the Temple: its own field joins, the Sanctum stops drawing.
    const templeRoot = await roster.build(async () => root(), null, temple.ox, temple.oz);
    roster.sync(102102, -1472);
    expect(sanctumRoot.visible).toBe(false);
    expect(templeRoot.visible).toBe(true);

    // Back to the Sanctum, then out to the overworld.
    roster.sync(sanctum.ox, sanctum.oz - 222);
    expect(sanctumRoot.visible).toBe(true);
    expect(templeRoot.visible).toBe(false);
    roster.sync(0, 0);
    expect(sanctumRoot.visible).toBe(false);
    expect(templeRoot.visible).toBe(false);
  });

  it('hides the Sanctum as soon as the player leaves, before the Temple is built', async () => {
    const roster = new OpenAirFieldRoster();
    const sanctumRoot = await roster.build(async () => root(), null, sanctum.ox, sanctum.oz);
    roster.sync(102102, -1472);
    expect(sanctumRoot.visible).toBe(false);
  });

  it('draws only the run the player is in of two slots of one dungeon', async () => {
    const roster = new OpenAirFieldRoster();
    const later = origin('drowned_temple', 5);
    const firstRun = await roster.build(async () => root(), null, temple.ox, temple.oz);
    const secondRun = await roster.build(async () => root(), null, later.ox, later.oz);
    roster.sync(later.ox + 2, later.oz - 222);
    expect(firstRun.visible).toBe(false);
    expect(secondRun.visible).toBe(true);
    roster.sync(102102, -1472);
    expect(firstRun.visible).toBe(true);
    expect(secondRun.visible).toBe(false);
  });

  it('never reveals a root the compile gate still holds hidden', async () => {
    const roster = new OpenAirFieldRoster();
    // attachSceneGroupGated hides the root until its programs link.
    const gated = await roster.build(async () => root(false), null, temple.ox, temple.oz);
    roster.sync(102102, -1472);
    expect(gated.visible).toBe(false);
    // Away and back while the gate is still pending: still the gate's.
    roster.sync(0, 0);
    roster.sync(102102, -1472);
    expect(gated.visible).toBe(false);
    // The gate settles: the reveal is the gate's, and it sticks.
    gated.visible = true;
    roster.sync(102102, -1472);
    expect(gated.visible).toBe(true);
  });

  it('hides a field whose gate settled after the player left, and shows it on return', async () => {
    const roster = new OpenAirFieldRoster();
    const gated = await roster.build(async () => root(false), null, temple.ox, temple.oz);
    roster.sync(0, 0);
    expect(gated.visible).toBe(false);
    gated.visible = true;
    roster.sync(0, 0);
    expect(gated.visible).toBe(false);
    roster.sync(102102, -1472);
    expect(gated.visible).toBe(true);
  });

  it('reveals only its own hide: a root another owner hides later stays hidden', async () => {
    const roster = new OpenAirFieldRoster();
    const field = await roster.build(async () => root(), null, temple.ox, temple.oz);
    // One full cycle of the roster's own hide and reveal.
    roster.sync(0, 0);
    roster.sync(102102, -1472);
    expect(field.visible).toBe(true);
    // Then someone else hides it while the player stands in it.
    field.visible = false;
    roster.sync(102102, -1472);
    expect(field.visible).toBe(false);
  });

  it('does not enrol a field whose builder failed', async () => {
    const roster = new OpenAirFieldRoster();
    const standing = await roster.build(async () => root(), null, temple.ox, temple.oz);
    await expect(
      roster.build(
        async (): Promise<ReturnType<typeof root>> => {
          throw new Error('kit failed');
        },
        null,
        temple.ox,
        temple.oz,
      ),
    ).rejects.toThrow('kit failed');
    // A phantom entry at this origin would be the newest, and take the cell.
    roster.sync(0, 0);
    roster.sync(102102, -1472);
    expect(standing.visible).toBe(true);
  });
});

describe('open-air field visibility wiring', () => {
  const dungeon = sourceOf('../src/render/dungeon.ts');
  const renderer = sourceOf('../src/render/renderer.ts');

  it('builds every open-air field through the roster (src/render/dungeon.ts)', () => {
    const start = dungeon.indexOf('const field = OPEN_AIR_FIELDS[interior];');
    expect(start).toBeGreaterThan(-1);
    const arm = statements(dungeon.slice(start, dungeon.indexOf('return group;', start)));
    expect(arm).toContain('const group = await this.openAirFields.build(field, deps, ox, oz);');
    // The roster is the only caller of an open-air builder, however spelled.
    expect(arm.filter((line) => /\bfield\s*\(/.test(line))).toEqual([]);
  });

  it('settles which field draws before the light budget ranks (src/render/renderer.ts)', () => {
    // A field root carries its fires' point lights, and the pass ranks against
    // the ancestry it sees: a root flipped after it would leave a returning
    // player's fires dark for a frame. So the sync is the first thing the
    // budget method does, unconditionally.
    const start = renderer.indexOf('  private budgetFireLights(px: number, pz: number');
    expect(start).toBeGreaterThan(-1);
    const body = statements(renderer.slice(start, renderer.indexOf('\n  private ', start + 1)));
    expect(body[1]).toBe('this.dungeons?.openAirFields.sync(px, pz);');
    expect(body[2]).toBe('runFireLightBudgetPass({');
    // Exactly one driver, so the roster is never ruled from two positions.
    const drivers = statements(`${renderer}\n${dungeon}`).filter((line) =>
      line.includes('openAirFields.sync('),
    );
    expect(drivers).toHaveLength(1);
  });

  it('runs that budget from the player position on both frame paths', () => {
    // Every call hands it the player, never the camera: the same position the
    // sim files under an instance, and the one the interior build keys on.
    const calls = statements(renderer).filter((line) => line.includes('this.budgetFireLights('));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call).toContain('this.budgetFireLights(p.pos.x, p.pos.z');
    // The prewarm frame and the live frame each run it unconditionally.
    const prewarm = renderer.indexOf('  private prewarmWorldFrame(');
    expect(prewarm).toBeGreaterThan(-1);
    const prewarmFrame = statements(
      renderer.slice(prewarm, renderer.indexOf('\n  private ', prewarm + 1)),
    );
    expect(prewarmFrame).toContain('this.budgetFireLights(p.pos.x, p.pos.z);');
    expect(statements(renderer)).toContain('this.budgetFireLights(p.pos.x, p.pos.z, true);');
  });
});
