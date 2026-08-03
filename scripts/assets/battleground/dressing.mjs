// The Thornhollow Fields DRESSING: every wall block, tower, gate arch, brazier,
// crate, boulder and tree that turns the combat plan into Thornhollow.
//
// The rule the whole file obeys: the PLAN owns the footprint, the dressing owns
// the look. A wall run is laid module by module along the exact rectangle the
// plan gives it, at the exact thickness the plan gives it; a rubble formation
// fills the exact radius the plan gives it, with its top held under the eye
// line so casts still pass over it the way they did on the code-defined field.
// Art that would change where a fighter can stand carries `collide: false`, and
// the two places where the look and the collision genuinely disagree (the heart
// ruin's hollow shell, the graveyard rails) get an explicit invisible collider
// volume, so what blocks is what the plan says blocks.
//
// The canonical half is Crimson (-z). Anything authored there is point-mirrored
// for Azure, so the two teams fight over the same build rather than two similar
// ones.
//
// Pure and deterministic: hashed scatter, no rng, no clock, no filesystem.

import {
  COVER_CRATES,
  COVER_PILLARS,
  COVER_WALLS,
  CURTAIN_WALLS,
  CURTAIN_Z,
  FLAG_Z,
  GATEHOUSE_ROOMS,
  GATEHOUSE_WALLS,
  GRAVEYARD_FENCES,
  GRAVEYARDS,
  HALF_X,
  HALF_Z,
  HEART_RUIN,
  KEEP_BARRICADES,
  KEEP_HALF_X,
  KEEP_MOUTH_DZ,
  keepWallSegments,
  MAIN_GATES,
  PERIMETER_WALLS,
  POWER_RUNES,
  RUBBLE_PILES,
  RUBBLE_RADIUS,
  SPEED_RUNES,
} from './field_plan.mjs';
import { bodyOffset, courseFit, mirrorPlacement, pieceExtents, r4, stream, yaw } from './kit.mjs';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

/** Nominal scale of a wall module: one course stands 5.75yd, the height the
 *  code-defined field's ramparts read at. */
const WALL_SCALE = 2.6;
/** How far a course is buried, so no module floats over rolling ground. */
const BURY = 0.3;
/** The ceiling every rubble formation is held under: BELOW the 1.6yd eye line,
 *  so a boulder field is movement cover and never sight cover. */
const RUBBLE_CEILING = 1.45;

const FLAME = 0xffc35a;
const CRIMSON_GLOW = 0xff6a4a;
const AZURE_GLOW = 0x5aa0ff;
const GRAVE_GLOW = 0x9fd8c8;

/** A stable 0..2pi yaw from a position: varied dressing, never random. */
function hashYaw(a, b) {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * TAU;
}

export function buildDressing({ assetData, heightAt, grassGround, softGround }) {
  const ext = (id) => pieceExtents(assetData, id);
  const wall = ext('dungeon/wall');
  const parapet = ext('dungeon/barrier');
  const halfWall = ext('dungeon/barrier_half');
  const broken = ext('dungeon/wall_broken');
  const tower = ext('city/wall_tower');
  const railPiece = ext('dungeon/fence_broken');

  const courseH = wall.top * WALL_SCALE; // 5.75yd per wall course
  const out = [];
  const lights = [];
  const decals = [];

  /** Author on the Crimson half; the Azure half is the same build, half-turned. */
  const both = (p) => {
    out.push(p);
    out.push(mirrorPlacement(p));
  };
  /**
   * The same, for a piece whose ART is team-coloured: the mirror swaps the
   * asset for its Azure twin, so a half-turn never hangs Crimson colours over
   * the Azure keep.
   */
  const bothTeamArt = (p, azureAssetId) => {
    out.push(p);
    out.push({ ...mirrorPlacement(p), assetId: azureAssetId });
  };
  const bothLights = (l) => {
    lights.push(l);
    lights.push({ ...l, x: r4(-l.x), z: r4(-l.z) });
  };
  /** A team-coloured light pair: Crimson here, Azure in the mirror. */
  const bothTeamLights = (l, azureColor) => {
    lights.push(l);
    lights.push({ ...l, x: r4(-l.x), z: r4(-l.z), color: azureColor });
  };

  /** Lowest ground under a footprint, so a seated piece never floats. */
  const floorUnder = (cx, cz, hw, hd) => {
    let lo = Infinity;
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        lo = Math.min(lo, heightAt(cx - hw + (i * hw) / 2, cz - hd + (j * hd) / 2));
      }
    }
    return lo;
  };

  /** Place a piece so its BODY centre lands on (x, z), not its authored origin. */
  const seated = (assetId, x, z, rotY, fields, extents, scaleX, scaleZ) => {
    const off = bodyOffset(extents, scaleX, scaleZ, rotY);
    return { assetId, x: r4(x + off.dx), z: r4(z + off.dz), rotY: yaw(rotY), ...fields };
  };

  // -------------------------------------------------------------------------
  // Wall runs
  // -------------------------------------------------------------------------

  /**
   * Lay a wall along one plan rectangle: `courses` stacked modules at the
   * plan's own thickness, optionally capped with a crenellated parapet. Each
   * module is seated on the lowest ground under its own footprint, so a run
   * STEPS with the terrain the way a built wall does rather than floating off
   * a swell or sinking into a hollow.
   */
  function wallRun(
    seg,
    { courses = 1, cap = true, mirror = true, name = 'Wall', ruinEnd = false } = {},
  ) {
    const alongX = seg.hw >= seg.hd;
    const length = (alongX ? seg.hw : seg.hd) * 2;
    const thickness = (alongX ? seg.hd : seg.hw) * 2;
    const rotY = alongX ? 0 : HALF_PI;
    const fit = courseFit(wall.width, length, WALL_SCALE);
    const capFit = courseFit(parapet.width, length, WALL_SCALE);
    const capDepth = thickness / (parapet.depth * WALL_SCALE);
    const emit = mirror ? both : (p) => out.push(p);
    for (let i = 0; i < fit.count; i++) {
      const t = -length / 2 + (i + 0.5) * fit.pitch;
      const x = alongX ? seg.x + t : seg.x;
      const z = alongX ? seg.z : seg.z + t;
      const seat =
        floorUnder(
          x,
          z,
          alongX ? fit.pitch / 2 : thickness / 2,
          alongX ? thickness / 2 : fit.pitch / 2,
        ) - BURY;
      // A ruined end SWAPS the last module for a broken one rather than
      // stacking a stub on top of it: a piece the eye reads as wall but the
      // camera boom glides through is worse than no ruin at all.
      const ruined = ruinEnd && i === fit.count - 1;
      const piece = ruined ? broken : wall;
      const scaleX = fit.pitch / (piece.width * WALL_SCALE);
      const depthScale = thickness / (piece.depth * WALL_SCALE);
      for (let c = 0; c < courses; c++) {
        emit(
          seated(
            ruined ? 'dungeon/wall_broken' : 'dungeon/wall',
            x,
            z,
            rotY,
            {
              scale: WALL_SCALE,
              collide: true,
              collisionMode: 'baked',
              scaleX: r4(scaleX),
              scaleZ: r4(depthScale),
              ...(c > 0 ? { y: r4(c * courseH) } : {}),
              detached: true,
              groundY: r4(seat),
              name,
            },
            piece,
            WALL_SCALE * scaleX,
            WALL_SCALE * depthScale,
          ),
        );
      }
    }
    if (!cap) return;
    for (let i = 0; i < capFit.count; i++) {
      const t = -length / 2 + (i + 0.5) * capFit.pitch;
      const x = alongX ? seg.x + t : seg.x;
      const z = alongX ? seg.z : seg.z + t;
      const seat =
        floorUnder(
          x,
          z,
          alongX ? capFit.pitch / 2 : thickness / 2,
          alongX ? thickness / 2 : capFit.pitch / 2,
        ) - BURY;
      emit(
        seated(
          'dungeon/barrier',
          x,
          z,
          rotY,
          {
            scale: WALL_SCALE,
            collide: true,
            collisionMode: 'baked',
            scaleX: r4(capFit.scaleX),
            scaleZ: r4(capDepth),
            y: r4(courses * courseH),
            detached: true,
            groundY: r4(seat),
            name: 'Parapet',
          },
          parapet,
          WALL_SCALE * capFit.scaleX,
          WALL_SCALE * capDepth,
        ),
      );
    }
  }

  /** A drum tower standing on the wall line, its foot sunk into the ground. */
  function wallTower(x, z, rotY, { scale = 1.6, mirror = true, name = 'Wall tower' } = {}) {
    const half = (tower.width * scale) / 2;
    const p = {
      assetId: 'city/wall_tower',
      x: r4(x),
      z: r4(z),
      rotY: yaw(rotY),
      scale,
      collide: true,
      collisionMode: 'baked',
      detached: true,
      groundY: r4(floorUnder(x, z, half, half) - 0.5),
      name,
    };
    if (mirror) both(p);
    else out.push(p);
  }

  // --- the perimeter enceinte ----------------------------------------------
  // Two courses and a crenellated cap: tall enough that the hollow's wooded
  // slope reads over the top and the world beyond the field never does.
  for (const seg of PERIMETER_WALLS) wallRun(seg, { courses: 2, mirror: false, name: 'Rampart' });
  wallTower(-HALF_X, -HALF_Z, HALF_PI, { scale: 1.9, name: 'Corner drum' });
  wallTower(HALF_X, -HALF_Z, -HALF_PI, { scale: 1.9, name: 'Corner drum' });
  // Mural drums straddle the rampart LINE (a tower projects from a wall, it
  // does not stand beside it), so their centres stay inside the field rect and
  // only their own radius reaches past it.
  for (const z of [-CURTAIN_Z, -108]) {
    wallTower(-HALF_X, z, HALF_PI);
    wallTower(HALF_X, z, -HALF_PI);
  }
  wallTower(-HALF_X, 0, HALF_PI, { mirror: false });
  wallTower(HALF_X, 0, -HALF_PI, { mirror: false });

  // --- the keeps ------------------------------------------------------------
  for (const seg of keepWallSegments(0)) wallRun(seg, { name: 'Keep wall' });
  for (const sx of [-KEEP_HALF_X, KEEP_HALF_X]) {
    wallTower(sx, -(FLAG_Z + KEEP_MOUTH_DZ), sx < 0 ? HALF_PI : -HALF_PI, {
      scale: 1.75,
      name: 'Keep drum',
    });
    wallTower(sx, -(FLAG_Z - KEEP_MOUTH_DZ), sx < 0 ? HALF_PI : -HALF_PI, {
      scale: 1.55,
      name: 'Gate drum',
    });
  }

  // The pocket behind each keep is left as OPEN GROUND on purpose. It carried a
  // raised stone plinth with stair runs off both flanks; playtesting killed it
  // on both counts. The plinth read as a platform and was not one (its top sits
  // a step and a half up, so a body bounces off the face instead of walking on),
  // and the stairs read as a route and were not one either: a stair GLB's baked
  // collision is a ramp deck the movement kernel only honours from the tread it
  // starts on, which is not how a player reads a staircase. Nothing that looks
  // walkable and is not belongs on a competitive field, so the whole structure
  // is gone rather than half-fixed. The keep's own banners and braziers carry
  // the ceremony now.

  // --- the curtains, their gates and the gatehouses --------------------------
  for (const seg of CURTAIN_WALLS) {
    if (seg.z > 0) continue;
    wallRun(seg, { name: 'Curtain' });
  }
  for (const seg of GATEHOUSE_WALLS) {
    if (seg.z > 0) continue;
    wallRun(seg, { name: 'Gatehouse' });
  }
  for (const gate of MAIN_GATES) {
    if (gate.z > 0) continue;
    // Solve the arch's x scale so its two piers stand exactly on the gate
    // jambs: the plan's 10yd crossing stays 10yd of clear ground.
    const LEG_INNER = 0.6011; // (leg centre - leg half width), model yards
    const archScale = 6;
    both({
      assetId: 'biome/dungeon_arch_stone',
      x: r4(gate.x),
      z: r4(gate.z),
      rotY: 0,
      scale: archScale,
      collide: true,
      collisionMode: 'baked',
      scaleX: r4(gate.half / (LEG_INNER * archScale)),
      detached: true,
      groundY: r4(floorUnder(gate.x, gate.z, gate.half + 4, 2) - 0.4),
      name: 'Main gate',
    });
    bothLights({ x: r4(gate.x), y: 6.5, z: r4(gate.z), color: FLAME, intensity: 26, range: 26 });
    // The gate wears the half's colours: one banner on the curtain wall each
    // side of the arch, on BOTH faces, so the heraldry reads whether a runner
    // is charging the gate or falling back through it. Hung clear of the arch
    // piers, thin cloth against a wall that already blocks.
    for (const bx of [gate.x - 8.5, gate.x + 8.5]) {
      for (const face of [-1, 1]) {
        bothTeamArt(
          {
            assetId: 'dungeon/banner_triple_red',
            x: r4(bx),
            z: r4(gate.z + face * 1.45),
            rotY: yaw(face < 0 ? Math.PI : 0),
            scale: 2,
            collide: false,
            y: 1.5,
            detached: true,
            groundY: r4(floorUnder(bx, gate.z, 1.5, 1.5) - BURY),
            name: 'Gate colours',
          },
          'dungeon/banner_triple_blue',
        );
      }
    }
  }

  // Gatehouse timber posts and a lantern. They COLLIDE: a post you can see and
  // walk through is the thing playtesting called out. They sit inside the room's
  // corners and hard against its east wall, so both offset doors keep their full
  // width and the ambush corners stay exactly where the plan put them.
  for (const room of GATEHOUSE_ROOMS) {
    if (room.z > 0) continue;
    const seat = floorUnder(room.x, room.z, room.hw, room.hd);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        both({
          assetId: 'props/timber_pillar',
          x: r4(room.x + sx * (room.hw - 1.4)),
          z: r4(room.z + sz * (room.hd - 1.4)),
          rotY: yaw(hashYaw(room.x + sx, room.z + sz)),
          scale: 3.4,
          collide: true,
          collisionMode: 'baked',
          detached: true,
          groundY: r4(seat - 0.2),
          name: 'Gatehouse post',
        });
      }
    }
    both({
      assetId: 'dungeon/lantern_standing',
      x: r4(room.x + 5.6),
      z: r4(room.z),
      rotY: 0,
      scale: 1.5,
      collide: true,
      collisionMode: 'baked',
      name: 'Gatehouse lantern',
    });
    bothLights({ x: r4(room.x), y: 4, z: r4(room.z), color: FLAME, intensity: 24, range: 24 });
  }

  // --- the mouth barricades -------------------------------------------------
  for (const seg of KEEP_BARRICADES) {
    if (seg.z > 0) continue;
    const length = seg.hw * 2;
    const scale = 2.4;
    const fit = courseFit(halfWall.width, length, scale);
    const depthScale = (seg.hd * 2) / (halfWall.depth * scale);
    for (let i = 0; i < fit.count; i++) {
      const x = seg.x - length / 2 + (i + 0.5) * fit.pitch;
      both(
        seated(
          'dungeon/barrier_half',
          x,
          seg.z,
          0,
          {
            scale,
            collide: true,
            collisionMode: 'baked',
            scaleX: r4(fit.scaleX),
            scaleZ: r4(depthScale),
            detached: true,
            groundY: r4(floorUnder(x, seg.z, fit.pitch / 2, seg.hd) - 0.25),
            name: 'Mouth barricade',
          },
          halfWall,
          scale * fit.scaleX,
          scale * depthScale,
        ),
      );
    }
  }

  // --- chamber cover --------------------------------------------------------
  for (const seg of COVER_WALLS) {
    if (seg.z > 0) continue;
    wallRun(seg, { cap: false, name: 'Cover wall', ruinEnd: true });
  }

  // --- the heart ruin -------------------------------------------------------
  // A roofless shell of two courses with a ragged crown and corner piers. Its
  // INTERIOR is sealed by an invisible volume, because on the plan the heart is
  // one solid mass: it is what stops a caster in one main gate seeing the other,
  // and a walk-through ruin would open that lane.
  {
    const seat = floorUnder(HEART_RUIN.x, HEART_RUIN.z, HEART_RUIN.hw, HEART_RUIN.hd) - BURY;
    const side = HEART_RUIN.hw * 2;
    const fit = courseFit(wall.width, side, WALL_SCALE);
    const depthScale = 2 / (wall.depth * WALL_SCALE);
    const faces = [
      { x: 0, z: -HEART_RUIN.hd, rotY: 0 },
      { x: 0, z: HEART_RUIN.hd, rotY: Math.PI },
      { x: -HEART_RUIN.hw, z: 0, rotY: HALF_PI },
      { x: HEART_RUIN.hw, z: 0, rotY: -HALF_PI },
    ];
    for (const face of faces) {
      const alongX = Math.abs(Math.sin(face.rotY)) < 0.5;
      for (let i = 0; i < fit.count; i++) {
        const t = -side / 2 + (i + 0.5) * fit.pitch;
        const x = alongX ? face.x + t : face.x;
        const z = alongX ? face.z : face.z + t;
        // The crown is deliberately ragged: the middle module of each face
        // stops a course short and finishes broken.
        const courses = i === 1 ? 1 : 2;
        for (let c = 0; c < courses; c++) {
          const piece = c === courses - 1 && courses === 1 ? broken : wall;
          out.push(
            seated(
              c === courses - 1 && courses === 1 ? 'dungeon/wall_broken' : 'dungeon/wall',
              x,
              z,
              face.rotY,
              {
                scale: WALL_SCALE,
                collide: true,
                collisionMode: 'baked',
                scaleX: r4(fit.scaleX),
                scaleZ: r4(depthScale),
                ...(c > 0 ? { y: r4(c * courseH) } : {}),
                detached: true,
                groundY: r4(seat),
                name: 'Heart ruin',
              },
              piece,
              WALL_SCALE * fit.scaleX,
              WALL_SCALE * depthScale,
            ),
          );
        }
      }
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push({
          assetId: 'dungeon/pillar',
          x: r4(sx * HEART_RUIN.hw),
          z: r4(sz * HEART_RUIN.hd),
          rotY: yaw(sx * sz * 0.4),
          scale: 2.4,
          collide: true,
          collisionMode: 'baked',
          scaleY: 2.1,
          detached: true,
          groundY: r4(seat),
          name: 'Ruin pier',
        });
      }
    }
    out.push({
      assetId: 'collider/box',
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: true,
      sizeX: r4(HEART_RUIN.hw * 2 - 1.6),
      sizeY: r4(courseH * 2),
      sizeZ: r4(HEART_RUIN.hd * 2 - 1.6),
      detached: true,
      groundY: r4(seat),
      name: 'Heart ruin core',
      hidden: true,
    });
    // Columns thrown down out of the shell: LYING, and solid. Prone they top out
    // around a yard, so a runner strides over one rather than being walled by
    // it, and the ring of ground around the heart keeps its width.
    const ruinRng = stream(17);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const rad = 11.5 + ruinRng.range(0, 2.5);
      out.push({
        assetId: 'props/column_broken',
        x: r4(Math.cos(a) * rad),
        z: r4(Math.sin(a) * rad),
        rotY: yaw(a + HALF_PI),
        rotZ: r4(HALF_PI),
        scale: r4(ruinRng.range(1.6, 2.3)),
        collide: true,
        collisionMode: 'baked',
        name: 'Fallen column',
      });
    }
    for (const [bx, bz] of [
      [11, 11],
      [-11, 11],
      [-11, -11],
      [11, -11],
    ]) {
      out.push({
        assetId: 'props/bonfire',
        x: bx,
        z: bz,
        rotY: 0,
        scale: 1.7,
        collide: true,
        collisionMode: 'baked',
        name: 'Ruin brazier',
      });
      lights.push({ x: bx, y: 3, z: bz, color: 0xffb04a, intensity: 30, range: 30 });
    }
  }

  // --- rune pads ------------------------------------------------------------
  for (const pad of [...SPEED_RUNES, ...POWER_RUNES]) {
    if (pad.z > 0.5) continue;
    // A pad ON the centre line is its own twin's mirror, so the pair (-38, 0)
    // and (38, 0) both survive the z filter and `both()` then authors each of
    // them AND the other, every midfield pad came out with two coincident
    // rings of four lanterns stacked in the same holes. Take one side only and
    // let the mirror supply the other.
    if (Math.abs(pad.z) <= 0.5 && pad.x > 0) continue;
    // No glyph slab under the pad. A 'dungeon/path_a' plate used to sit here,
    // and it read as a loose rock dropped on the ground: the mode draws its own
    // glow disc and spinning body at this exact spot, so the plate only hid the
    // painted cobble the pad was sited on. The four lanterns still ring it.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      both({
        assetId: 'dungeon/post_lantern',
        x: r4(pad.x + Math.cos(a) * 3.7),
        z: r4(pad.z + Math.sin(a) * 3.7),
        // Face the arm INWARD, so all four hang their lamp over the pad. The
        // post's arm runs down its own +Z, and rotY maps local +Z to world
        // (sin, cos), so aiming it at the centre, world (-cos a, -sin a) ,
        // solves to -a - PI/2. Passing `a` (what this used to do) pointed each
        // post a different way round and only one of the four happened to look
        // right. See LANTERN_ARM_LOCAL in battleground_lantern_fx_core.ts,
        // which reads the same model the same way for the flame emitter.
        rotY: yaw(-a - Math.PI / 2),
        scale: 1.5,
        collide: true,
        collisionMode: 'baked',
        name: 'Rune lantern',
      });
    }
  }

  // --- cover pillars and crates --------------------------------------------
  for (const p of COVER_PILLARS) {
    if (p.z > 0.5) continue;
    both({
      assetId: 'dungeon/pillar',
      x: r4(p.x),
      z: r4(p.z),
      rotY: yaw(hashYaw(p.x, p.z)),
      scale: 2.1,
      collide: true,
      collisionMode: 'baked',
      scaleY: 1.35,
      name: 'Court pillar',
    });
  }
  const CRATE_KINDS = [
    ['dungeon/crates_stacked', 1.2],
    ['props/crate_wooden', 1.05],
    ['dungeon/barrel_large', 1.1],
  ];
  COVER_CRATES.forEach((c, i) => {
    if (c.z > 0.5) return;
    const [assetId, scale] = CRATE_KINDS[i % CRATE_KINDS.length];
    both({
      assetId,
      x: r4(c.x),
      z: r4(c.z),
      rotY: yaw(hashYaw(c.x * 1.7, c.z)),
      scale,
      collide: true,
      collisionMode: 'baked',
      name: 'Field stores',
    });
    both({
      assetId: 'dungeon/crate_small',
      x: r4(c.x + Math.cos(hashYaw(c.z, c.x)) * 1.5),
      z: r4(c.z + Math.sin(hashYaw(c.z, c.x)) * 1.5),
      rotY: yaw(hashYaw(c.z * 3, c.x)),
      scale: 0.85,
      collide: true,
      collisionMode: 'baked',
      name: 'Field stores',
    });
  });

  // --- rubble formations ----------------------------------------------------
  // Boulder fields at natural proportions, each stone scaled so the whole
  // formation tops out under RUBBLE_CEILING: a runner rounds them or vaults
  // them, a caster sees straight over them, exactly as on the code-defined
  // field where these were low circles with a 1.4yd sight top.
  {
    const ROCKS = ['foliage/rock_1', 'foliage/rock_2', 'foliage/rock_3'];
    const rubble = [];
    for (const pile of RUBBLE_PILES) {
      if (pile.z > 0.5) continue;
      const radius = RUBBLE_RADIUS[pile.kind];
      const stones = pile.kind === 'large' ? 9 : 4;
      const rng = stream(Math.round((pile.x + 60) * 7 + (pile.z + 160) * 13));
      for (let i = 0; i < stones; i++) {
        const a = (i / stones) * TAU + rng.range(-0.35, 0.35);
        const rad = i === 0 ? 0 : radius * rng.range(0.35, 0.86);
        const kind = rng.pick(ROCKS);
        const stone = ext(kind);
        rubble.push({
          assetId: kind,
          x: r4(pile.x + Math.cos(a) * rad),
          z: r4(pile.z + Math.sin(a) * rad),
          rotY: yaw(rng.range(0, TAU)),
          scale: r4((RUBBLE_CEILING * rng.range(0.62, 1)) / stone.top),
          collide: true,
          collisionMode: 'baked',
          name: 'Rubble',
        });
      }
      // Debris plates lying between the stones: art only, and kept small, so a
      // formation reads as broken ground rather than as a heap of slabs.
      for (let i = 0; i < (pile.kind === 'large' ? 5 : 2); i++) {
        const a = rng.range(0, TAU);
        rubble.push({
          assetId: 'dungeon/rubble_large',
          x: r4(pile.x + Math.cos(a) * radius * rng.range(0.4, 1)),
          z: r4(pile.z + Math.sin(a) * radius * rng.range(0.4, 1)),
          rotY: yaw(a + HALF_PI),
          scale: r4(rng.range(0.8, 1.4)),
          collide: true,
          collisionMode: 'baked',
          name: 'Debris',
        });
      }
    }
    for (const p of rubble) both(p);
  }

  // --- the graveyards -------------------------------------------------------
  // THREE headstones per plot, and their placement is the point. A released
  // spirit rises on a fixed five-spot grid (spirit.ts bgGraveyardSpot: x +-3,
  // z -3/0/+3 off the plot centre) and leaves by the 4yd gap the plan opens at
  // the KEEP-SIDE corner. Playtesting found the old twelve-stone yard was a
  // maze: every stone stands taller than the eye line, so a spirit could not
  // even see the way out, let alone walk to it. The three that remain are
  // pushed into the far (east) strip, so the whole half of the plot the gap is
  // on stays open ground, and they are cut down to headstone size rather than
  // the monoliths they were. Anything added here has to keep that half clear.
  const STONES = [
    ['dungeon/gravestone', 39.5, -134.5],
    ['props/gravestone_cross', 40.8, -130.5],
    ['dungeon/grave_a', 39, -126.5],
  ];
  for (const plot of GRAVEYARDS) {
    if (plot.z > 0) continue;
    const rng = stream(311);
    for (const [assetId, gx, gz] of STONES) {
      both({
        assetId,
        x: r4(gx),
        z: r4(gz),
        rotY: yaw(rng.range(-0.25, 0.25)),
        scale: r4(rng.range(1.05, 1.3)),
        collide: true,
        collisionMode: 'baked',
        name: 'Grave',
      });
    }
    // One lantern, in the corner furthest from both the rise spots and the gap.
    both({
      assetId: 'dungeon/lantern_standing',
      x: r4(plot.x - 7.5),
      z: r4(plot.z - 4.5),
      rotY: 0,
      scale: 1.5,
      collide: true,
      collisionMode: 'baked',
      name: 'Grave lantern',
    });
    bothLights({ x: r4(plot.x), y: 3, z: r4(plot.z), color: GRAVE_GLOW, intensity: 20, range: 24 });
  }
  // Rails: broken fence art over an invisible rail volume, so a plot blocks
  // sight and movement exactly as the plan's fence rectangles say it does.
  for (const seg of GRAVEYARD_FENCES) {
    if (seg.z > 0) continue;
    const alongX = seg.hw >= seg.hd;
    const length = (alongX ? seg.hw : seg.hd) * 2;
    const fit = courseFit(railPiece.width, length, 2);
    for (let i = 0; i < fit.count; i++) {
      const t = -length / 2 + (i + 0.5) * fit.pitch;
      both({
        assetId: 'dungeon/fence_broken',
        x: r4(alongX ? seg.x + t : seg.x),
        z: r4(alongX ? seg.z : seg.z + t),
        rotY: yaw(alongX ? 0 : HALF_PI),
        scale: 2,
        collide: false,
        scaleX: r4(fit.scaleX),
        name: 'Grave rail',
      });
    }
    both({
      assetId: 'collider/box',
      x: r4(seg.x),
      z: r4(seg.z),
      rotY: 0,
      scale: 1,
      collide: true,
      sizeX: r4(seg.hw * 2),
      sizeY: 1.8,
      sizeZ: r4(seg.hd * 2),
      name: 'Grave rail',
      hidden: true,
    });
  }

  // -------------------------------------------------------------------------
  // Garrison and battlefield dressing
  // -------------------------------------------------------------------------

  // Wall torches down the inward faces of the keep, the curtains and the
  // gatehouses: the field's warmth, and the reason its stone reads at dusk.
  for (const seg of [
    ...keepWallSegments(0),
    ...CURTAIN_WALLS.filter((s) => s.z < 0),
    ...GATEHOUSE_WALLS.filter((s) => s.z < 0),
  ]) {
    const alongX = seg.hw >= seg.hd;
    const length = (alongX ? seg.hw : seg.hd) * 2;
    const count = Math.max(1, Math.round(length / 13));
    const inward = Math.sign(-(alongX ? seg.z : seg.x)) || 1;
    for (let i = 0; i < count; i++) {
      const t = -length / 2 + ((i + 0.5) * length) / count;
      const x = alongX ? seg.x + t : seg.x + inward * (seg.hw + 0.35);
      const z = alongX ? seg.z + inward * (seg.hd + 0.35) : seg.z + t;
      both({
        assetId: 'dungeon/torch_mounted',
        x: r4(x),
        z: r4(z),
        rotY: yaw(alongX ? (inward > 0 ? 0 : Math.PI) : inward > 0 ? -HALF_PI : HALF_PI),
        scale: 1.1,
        collide: false,
        y: 3.3,
        detached: true,
        groundY: r4(floorUnder(x, z, 1, 1) - BURY),
        name: 'Wall torch',
      });
    }
  }

  // The keep court: the team's shield banners on the back wall over the flag,
  // arms racks and stores against the side walls. Everything hugs a wall, so
  // the court stays the clean fight space the plan intends. A banner is a
  // WALL-HUNG piece: it always hangs on stone, never stands free in the court
  // (a floating cloth was the first thing playtesting called out).
  const courtSeat = floorUnder(0, -FLAG_Z, 14, 8);
  for (const sx of [-1, 1]) {
    bothTeamArt(
      {
        assetId: 'dungeon/banner_shield_red',
        x: r4(sx * 7),
        z: -126.6,
        rotY: 0,
        scale: 2.4,
        collide: true,
        collisionMode: 'baked',
        y: 0.5,
        detached: true,
        groundY: r4(courtSeat),
        name: 'Court banner',
      },
      'dungeon/banner_shield_blue',
    );
    both({
      assetId: 'props/weapon_stand',
      x: r4(sx * 13.2),
      z: -122,
      rotY: yaw(sx < 0 ? -HALF_PI : HALF_PI),
      scale: 1.5,
      collide: true,
      collisionMode: 'baked',
      name: 'Arms rack',
    });
    both({
      assetId: 'dungeon/barrel_small_stack',
      x: r4(sx * 13.4),
      z: -113,
      rotY: yaw(sx < 0 ? -HALF_PI : HALF_PI),
      scale: 1.15,
      collide: true,
      collisionMode: 'baked',
      name: 'Court stores',
    });
  }

  // The flag stand itself: a two-step stone dais under the flag, with the
  // team's colours on the wall behind it. No firepits here anymore: an open
  // flame on the one spot every fight converges on read as a hazard, and the
  // stand carries the ceremony instead. Both dais steps finish far under the
  // physics step height, so the dais is ground a body strides over rather than
  // a ledge. Being low stone it also finishes under the sight cutoff, so the
  // compiler's `cameraTopY` classification leaves it transparent to casts and a
  // fight on the stand stays readable from across the court. (That top is now a
  // SIGHT input only: the geometry-driven chase-camera zoom that used to read
  // collider metadata was removed in release v0.34.0, and occluders fade
  // instead.) Nothing stands free around the stand: the court keeps the clean
  // fight space the plan intends, and tests/battleground_band pins the whole
  // contract (dais step height, pickup clearance, no blocker by the stand).
  both({
    assetId: 'dungeon/path_a',
    x: 0,
    z: -FLAG_Z,
    rotY: 0,
    scale: 3.2,
    collide: true,
    collisionMode: 'baked',
    y: 0.05,
    name: 'Flag dais',
  });
  both({
    assetId: 'dungeon/path_a',
    x: 0,
    z: -FLAG_Z,
    rotY: yaw(0.5),
    scale: 2.1,
    collide: true,
    collisionMode: 'baked',
    y: 0.42,
    name: 'Flag dais',
  });
  // ONE team-coloured glow over each stand: the field's authored light set has
  // to fit the renderer's per-tier budget (14 on the top tiers), and a light
  // past the budget is authored cost that never reaches a frame.
  bothTeamLights(
    { x: 0, y: 4.5, z: -FLAG_Z, color: CRIMSON_GLOW, intensity: 30, range: 32 },
    AZURE_GLOW,
  );

  // The keep's colours on the OUTSIDE of the castle, as the code-defined field
  // flew them: two standards high on the back rampart over the keep, and one on
  // each side wall's outer face by the mouth, so a runner reads whose keep they
  // are charging from anywhere in the chamber. Cloth against stone: thin, no
  // collision, and the wall behind each one is what blocks.
  for (const sx of [-1, 1]) {
    bothTeamArt(
      {
        assetId: 'dungeon/banner_triple_red',
        x: r4(sx * 7),
        z: -138.5,
        rotY: 0,
        scale: 3.2,
        collide: false,
        y: 5.6,
        detached: true,
        groundY: r4(floorUnder(sx * 7, -138.5, 2, 1) - BURY),
        name: 'Keep standard',
      },
      'dungeon/banner_triple_blue',
    );
    bothTeamArt(
      {
        assetId: 'dungeon/banner_triple_red',
        x: r4(sx * 17.4),
        z: -111.5,
        rotY: yaw(sx < 0 ? HALF_PI : -HALF_PI),
        scale: 2.4,
        collide: false,
        y: 2.2,
        detached: true,
        groundY: r4(floorUnder(sx * 17.4, -111.5, 1, 2) - BURY),
        name: 'Keep colours',
      },
      'dungeon/banner_triple_blue',
    );
  }

  // The camp in the pocket beside each keep: tents, a fire, a cart, hay.
  {
    const campX = -34;
    const campZ = -128;
    const seat = floorUnder(campX, campZ, 10, 8);
    for (const [assetId, dx, dz, scale, collide] of [
      ['biome/camp_tent', -6, -4, 2.6, true],
      ['biome/camp_tent', 5, -6, 2.4, true],
      ['biome/camp_bedroll', -6, 1, 1.5, true],
      ['biome/camp_fire_pit', 0, -1, 1.6, true],
      ['props/cart', 8, 3, 1.6, true],
      ['dungeon/haybale', -9, 4, 1.4, true],
      ['dungeon/wagon', 3, 6, 1.7, true],
      ['dungeon/chest_large', -2, 4, 1.2, true],
      ['props/barrel', 6, -1, 1.2, true],
    ]) {
      both({
        assetId,
        x: r4(campX + dx),
        z: r4(campZ + dz),
        rotY: yaw(hashYaw(campX + dx, campZ + dz)),
        scale,
        collide,
        ...(collide ? { collisionMode: 'baked' } : {}),
        detached: true,
        groundY: r4(seat),
        name: 'Keep camp',
      });
    }
  }

  // The courtyard's aftermath: bones, broken arms and skulls through the sunken
  // heart, plus blood underfoot where the fighting concentrates.
  {
    const rng = stream(907);
    // Real-world widths, solved back through each piece's own extents: the kit
    // normalizes every model to about 2.2yd, so a skull placed at "scale" reads
    // boulder-sized unless the size it should actually be is stated here.
    // Litter is scaled by its TOP, not its width: everything on this list has to
    // finish under the physics step height so a body walks straight over it.
    // Sized by width instead, a broken sword-and-shield comes out nearly two
    // yards tall, which is a sight blocker dropped at random in the courtyard.
    const LITTER = ['dungeon/skull', 'dungeon/bone_c', 'dungeon/sword_shield_broken'];
    const LITTER_TOP = 0.72; // under MAX_STEP_HEIGHT (0.9), with room to spare
    for (let i = 0; i < 34; i++) {
      const a = rng.range(0, TAU);
      const rad = rng.range(11, 40);
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const assetId = rng.pick(LITTER);
      if (z > 0.5) continue;
      both({
        assetId,
        x: r4(x),
        z: r4(z),
        rotY: yaw(rng.range(0, TAU)),
        scale: r4((LITTER_TOP * rng.range(0.55, 1)) / ext(assetId).top),
        collide: true,
        collisionMode: 'baked',
        name: 'Aftermath',
      });
    }
    for (const d of [
      { x: 6.4, z: -3.2, tex: 'builtin:blood_pool', size: 5.5, rot: 1.2 },
      { x: -4.1, z: -7.8, tex: 'builtin:blood_splatter', size: 7.5, rot: 4.1 },
      { x: 1.2, z: -13.5, tex: 'builtin:blood_pool', size: 4, rot: 2.6 },
      { x: 12.5, z: -18, tex: 'builtin:blood_splatter', size: 9, rot: 5.4 },
      { x: -13.5, z: -24, tex: 'builtin:blood_pool', size: 4.5, rot: 0.4 },
      { x: 13, z: -50, tex: 'builtin:blood_splatter', size: 8, rot: 3.3 },
      { x: -26, z: -56, tex: 'builtin:blood_pool', size: 5, rot: 2.1 },
    ]) {
      decals.push(d);
      decals.push({ ...d, x: r4(-d.x), z: r4(-d.z), rot: r4((d.rot + Math.PI) % TAU) });
    }
  }

  // -------------------------------------------------------------------------
  // Green: the hollow the fortress was cut into
  // -------------------------------------------------------------------------

  // Undergrowth inside the walls: on soft ground only (the paint sampler keeps
  // a fern off the flagstones), hugging the walls rather than standing in a
  // lane.
  {
    const rng = stream(1301);
    const KINDS = ['foliage/fern', 'foliage/bush', 'foliage/bush_flowers'];
    for (let i = 0; i < 760; i++) {
      const x = rng.range(-HALF_X + 1, HALF_X - 1);
      const z = rng.range(-HALF_Z + 1, 0);
      const edge = Math.min(HALF_X - Math.abs(x), HALF_Z - Math.abs(z));
      if (edge > 7 && rng.next() > 0.3) continue;
      if (!softGround(x, z)) continue;
      both({
        assetId: rng.pick(KINDS),
        x: r4(x),
        z: r4(z),
        rotY: yaw(rng.range(0, TAU)),
        scale: r4(rng.range(0.55, 1.15)),
        collide: false,
        name: 'Undergrowth',
      });
    }
    // Twisted trees rooted along the ramparts. They COLLIDE, because a
    // fifteen-yard tree a body walks through is the single most jarring thing
    // on a field, and they are pushed hard against the wall (|x| 47) so the
    // trunk projects from the rampart instead of standing in the flank lane.
    // Only species with BAKED collision are eligible: an unbaked one would fall
    // back to a guessed circle, and this field blocks with measured bodies only.
    for (const [x, z] of [
      [-47, -18],
      [47, -44],
      [-47, -78],
      [47, -92],
      [-20, -136],
      [20, -138],
    ]) {
      both({
        assetId: rng.pick(['foliage/twisted_1', 'foliage/twisted_3']),
        x,
        z,
        rotY: yaw(rng.range(0, TAU)),
        scale: r4(rng.range(1.4, 1.9)),
        collide: true,
        collisionMode: 'baked',
        name: 'Hollow tree',
      });
    }
  }

  // Grass tufts: procedural cross-billboards the renderer merges into one mesh.
  // Only where the ground was PAINTED as grass, so tufts never sprout through a
  // flagstone court, a road or the courtyard's broken rock.
  {
    const rng = stream(2003);
    for (let i = 0; i < 1700; i++) {
      const x = rng.range(-HALF_X + 1.5, HALF_X - 1.5);
      const z = rng.range(-HALF_Z + 1.5, 0.5);
      if (z > 0.5) continue;
      if (!grassGround(x, z)) continue;
      both({
        assetId: 'grass/patch',
        x: r4(x),
        z: r4(z),
        rotY: yaw(rng.range(0, TAU)),
        scale: r4(rng.range(0.8, 1.45)),
        collide: false,
        hue: 104,
        lum: 0.34,
        clump: 16,
      });
    }
  }

  // The wooded slope OUTSIDE the field: the hollow's lip, rising away over the
  // rampart tops on detached anchors, so it is pure silhouette and never
  // touches the ground the sim owns. Nothing here collides and nothing here is
  // reachable; the enceinte stands between it and the field.
  {
    const rng = stream(4201);
    const TREES = [
      'foliage/pine_1',
      'foliage/pine_2',
      'foliage/pine_3',
      'foliage/pine_5',
      'foliage/oak_1',
      'foliage/oak_2',
      'foliage/oak_3',
      'foliage/oak_5',
    ];
    // Two bands. The INNER one is broad-crowned and seated at the field's own
    // level, so what shows over a 13yd rampart is the fat middle of a canopy
    // and the slope reads as a solid wall of leaf; the OUTER one climbs away on
    // rising anchors and is mostly conifer, which is what gives the hollow its
    // skyline.
    const BROAD = ['foliage/oak_1', 'foliage/oak_2', 'foliage/oak_3', 'foliage/oak_5'];
    for (const band of [
      { count: 420, from: 3, span: 15, lift: 0, rise: 5, kinds: BROAD, scale: [3.1, 4.1] },
      { count: 340, from: 18, span: 34, lift: 7, rise: 24, kinds: TREES, scale: [2.6, 3.8] },
    ]) {
      for (let i = 0; i < band.count; i++) {
        const depth = rng.next() ** 0.7; // denser toward the wall
        const along = rng.range(-1, 1);
        const bank = band.from + depth * band.span;
        const endCap = rng.next() < 0.36;
        const x = endCap
          ? along * (HALF_X + bank * 0.7)
          : (rng.next() < 0.5 ? -1 : 1) * (HALF_X + bank);
        const z = endCap ? -(HALF_Z + bank) : along * (HALF_Z + bank * 0.5);
        if (z > 0.5) continue;
        both({
          assetId: rng.pick(band.kinds),
          x: r4(x),
          z: r4(z),
          rotY: yaw(rng.range(0, TAU)),
          scale: r4(rng.range(band.scale[0], band.scale[1])),
          collide: false,
          scaleY: r4(rng.range(0.92, 1.2)),
          detached: true,
          groundY: r4(band.lift + depth * band.rise + rng.range(-1.2, 1.2)),
          name: 'Hollow slope',
        });
      }
    }
  }

  return { placements: out, lights, decals };
}
