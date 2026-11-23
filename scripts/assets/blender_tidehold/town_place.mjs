// Re-seat the Deepglass map's Tidehold town placements on the rebuilt kit
// (bl_town.py -> town_install.mjs): run once after an install that changed a
// building's size, base or fire seats.
//
//   - scale = maxDim / 2.2 x TOWN_SCALE: the kit is authored in yards, so at 1
//     every building renders at its authored size; TOWN_SCALE (1.3) enlarges
//     the lot.
//   - y keeps each placement's MODEL ORIGIN (the ground line of the building)
//     where it was: the loader seats the lowest vertex, and the new plinth runs
//     1.0 yd under the origin (the market 0.8) where the old ones ran 0-0.93.
//     SPACEY's per-placement sink into a slope is preserved exactly.
//   - fireEffects: rebuilt from the sidecar's flame seats (hearths, forge and
//     coals, chandeliers, sconces, altar candles) with the style templates the
//     old placements used.
//   - placement-level `hitboxes` on a rebuilt building are dropped: they were
//     copies of the OLD asset override and would shadow the new one.
//   - SWAPS: two houses on the market streets become the new shops.
//   - NPCs standing in a rebuilt interior move to its new seats (the
//     innkeeper behind the new bar, Old Perrin by the new hearth).
//
//   node scripts/assets/blender_tidehold/town_place.mjs [--dry]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DRY = process.argv.includes('--dry');
const mapPath = path.join(root, 'data/maps/deepglass.map.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const report = JSON.parse(
  fs.readFileSync(path.join(root, 'tmp/asset_src/tidehold_town/install_report.json'), 'utf8'),
);
// the map as it was BEFORE the rebuild (straight from git, so a clean clone can re-run this):
// origins and swaps always derive from it, so a re-run after a re-install is exact
const BASE_COMMIT = 'e3222d6ba9'; // the last commit before the town kit rebuild
const base = JSON.parse(
  execSync(`git show ${BASE_COMMIT}:data/maps/deepglass.map.json`, {
    cwd: root,
    maxBuffer: 1 << 26,
  }).toString(),
);
const baseAt = (x, z) =>
  base.placements.find((q) => /^tidehold\//.test(q.assetId) && Math.hypot(q.x - x, q.z - z) < 0.05);
// the OLD kit's measurements (git HEAD before the rebuild), for origin-keeping
const OLD = {
  house_a: { minY: -0.925, maxDim: 14.43 },
  house_b: { minY: -0.925, maxDim: 19.42 },
  house_c: { minY: -0.925, maxDim: 19.24 },
  house_d: { minY: -0.925, maxDim: 22.35 },
  house_e: { minY: -0.925, maxDim: 23.91 },
  tavern: { minY: -0.006, maxDim: 26.78 },
  tavern_b: { minY: -0.749, maxDim: 58.82 },
  smithy: { minY: -0.006, maxDim: 21.1 },
  market: { minY: -0.457, maxDim: 35.64 },
  hall: { minY: -0.006, maxDim: 34.74 },
  bank: { minY: -0.148, maxDim: 27.03 }, // the old kit bank (bl_bank.py), measured 2026-09-26
};
// placements (by position) that become shops
const SWAPS = [
  { at: [94.5, 351.3], from: 'house_c', to: 'shop_a' },
  { at: [-42.5, 330.2], from: 'house_d', to: 'shop_b' },
];
// Every rebuilt building renders 30% over its authored yards (SPACEY,
// 2026-09-27: "change the scale of all the buildings that we built 2day to be
// 30% bigger"): the placement scale, the plinth's seat below the origin, the
// fire seats (placement fireEffects are WORLD yards off the seat) and the NPC
// seats (toWorld reads the placement scale) all follow it.
const TOWN_SCALE = 1.3;
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

const TORCH = {
  enabled: true,
  anchor: 'base',
  style: 'torch',
  blend: 'additive',
  width: 0.6,
  height: 0.55,
  flames: 2,
  intensity: 1.5,
  opacity: 0.42,
  glow: 2.4,
  glowRange: 15,
  smoke: 0,
  smokeScale: 0.9,
  smokeRise: 1.2,
  hue: 28,
  saturation: 1,
  speed: 1.05,
  turbulence: 0.55,
  flicker: 0.65,
  embers: 0.22,
};
const SCONCE = { ...TORCH, opacity: 0.5, glow: 1.6, glowRange: 9, width: 0.5, height: 0.5 };
const HEARTH = {
  enabled: true,
  anchor: 'base',
  style: 'bonfire',
  blend: 'additive',
  width: 1.45,
  height: 1.15,
  flames: 5,
  intensity: 2.4,
  opacity: 0.96,
  glow: 2.6,
  glowRange: 15,
  smoke: 0.15,
  smokeScale: 1.35,
  smokeRise: 2.1,
  hue: 24,
  saturation: 1,
  speed: 1.2,
  turbulence: 0.85,
  flicker: 0.82,
  embers: 0.66,
};
const FORGE = {
  ...HEARTH,
  glow: 2.2,
  glowRange: 12,
  smoke: 0.3,
  width: 1.1,
  height: 1.0,
  flames: 4,
};
const EMBERS = {
  enabled: true,
  anchor: 'base',
  style: 'embers',
  blend: 'additive',
  width: 1.0,
  height: 0.5,
  flames: 3,
  intensity: 1.6,
  opacity: 0.85,
  glow: 2.2,
  glowRange: 8,
  smoke: 0.1,
  smokeScale: 1,
  smokeRise: 1.4,
  hue: 20,
  saturation: 1,
  speed: 0.8,
  turbulence: 0.5,
  flicker: 0.7,
  embers: 1,
};

function emitters(name) {
  return (report[name]?.flames ?? []).map((f) => {
    const t =
      f.style === 'bonfire'
        ? f.id === 'forge'
          ? FORGE
          : HEARTH
        : f.style === 'embers'
          ? EMBERS
          : /^sconce|^altar/.test(f.id)
            ? SCONCE
            : TORCH;
    // the sidecar's scale is the Blender seat's own (0.3 a candle ring, 0.75 a
    // hearth); the torch template reads best a little under it
    const scale = r2((f.style === 'torch' ? f.scale * 0.8 : f.scale) * TOWN_SCALE);
    // the map's canonical key order (the publish sanitizer writes it so)
    const { enabled, anchor, style, blend, ...rest } = t;
    // ids are [a-z0-9_-] (the publish sanitizer renames anything else to fire-N)
    return {
      id: f.id.replace(/\+/g, 'p'),
      enabled,
      anchor,
      style,
      blend,
      x: r4(f.x * TOWN_SCALE),
      y: r4(f.y * TOWN_SCALE),
      z: r4(f.z * TOWN_SCALE),
      scale,
      ...rest,
    };
  });
}

/** Model (glTF x, z) of a placement -> world, three's yaw convention. */
function toWorld(p, x, z) {
  const k = (p.scale * 2.2) / report[p.assetId.split('/')[1]].maxDim;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  return [p.x + (x * c + z * s) * k, p.z + (-x * s + z * c) * k];
}

let moved = 0;
for (const p of map.placements) {
  if (
    !/^tidehold\/(house_[a-e]|tavern|tavern_b|smithy|market|hall|shop_[ab]|bank)$/.test(p.assetId)
  )
    continue;
  const b0 = baseAt(p.x, p.z);
  if (!b0) throw new Error(`no baseline placement for ${p.assetId} at (${p.x}, ${p.z})`);
  const m = /^tidehold\/(house_[a-e]|tavern|tavern_b|smithy|market|hall|bank)$/.exec(b0.assetId);
  let name = m[1];
  const old = OLD[name];
  const kOld = (b0.scale * 2.2) / old.maxDim;
  const originY = (b0.y ?? 0) - old.minY * kOld; // the model origin above the seat, as it was
  const sw = SWAPS.find((q) => q.from === name && Math.hypot(p.x - q.at[0], p.z - q.at[1]) < 1.0);
  if (sw) {
    name = sw.to;
    p.assetId = `tidehold/${name}`;
  }
  const rep = report[name];
  p.scale = r4((rep.maxDim / 2.2) * TOWN_SCALE);
  p.y = r2(originY + rep.minY * TOWN_SCALE); // the origin (the ground line) stays where it stood
  delete p.hitboxes;
  const fx = emitters(name);
  if (fx.length) p.fireEffects = fx;
  else delete p.fireEffects;
  moved++;
  console.log(
    `  ${p.assetId.padEnd(16)} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) scale ${p.scale} y ${p.y}${sw ? '  <- swapped from ' + sw.from : ''}`,
  );
}

// NPCs in the rebuilt interiors
const npcs = map.content.npcs;
const list = Array.isArray(npcs) ? npcs : Object.values(npcs);
function seat(id, local, facingLocal, building = 'tavern') {
  const n = list.find((q) => q.id === id);
  const host = map.placements.find((p) => p.assetId === `tidehold/${building}`);
  if (!n || !host || !local) return;
  const [wx, wz] = toWorld(host, local[0], local[1]);
  const pos = n.pos ?? n;
  pos.x = r2(wx);
  pos.z = r2(wz);
  n.facing = r4(host.rotY + facingLocal);
  console.log(`  npc ${id} -> ${building} (${pos.x}, ${pos.z}) facing ${n.facing}`);
}
// the innkeeper behind the bar, facing the room (local -z = the street door);
// Old Perrin at the hearth side, facing the fire (local -x)
seat('th_innkeeper', report.tavern.npcs.innkeeper, Math.PI);
seat('th_market_folk_4', report.tavern.npcs.hearth, -Math.PI / 2);
// the two shops' keepers behind their counters, facing the door (SPACEY,
// 2026-09-26: "these 2 shops need interiors so you can buy stuff there"):
// the market's trade-goods factor and its apothecary move indoors
seat('th_market_reagents', report.shop_a?.npcs?.shopkeeper, Math.PI, 'shop_a');
seat('th_market_tonics', report.shop_b?.npcs?.shopkeeper, Math.PI, 'shop_b');
// the Coffer-Keeper behind the Deepglass Vault's middle teller window
seat('th_banker', report.bank?.npcs?.banker, Math.PI, 'bank');
// the World Market's auctioneer at the auction house's centre booth (the
// market hall's site, rebuilt as the auction house on 2026-09-26)
seat('th_merchant', report.market?.npcs?.auctioneer, Math.PI, 'market');
// ...and an auctioneer behind every other lectern, facing the crowd (SPACEY,
// 2026-09-26: "they need to have characters standing behind them facing the
// crowd of people"). Each is a World Market NPC (market: true: every
// auctioneer anchors the shared market); created once, re-seated after.
const AUCTIONEERS = [
  [
    'th_auctioneer_w',
    'auctioneer_w',
    Math.PI,
    'Auctioneer Brannoc Saltmere',
    0x6f8fb8,
    'Bids close when the bell rings, $C. Not a breath before.',
  ],
  [
    'th_auctioneer_e',
    'auctioneer_e',
    Math.PI,
    'Auctioneer Velda Kestrin',
    0xa8745a,
    "Everything on this floor came up the cliff road on somebody's back. Price it like it did.",
  ],
  [
    'th_auctioneer_wall_w',
    'auctioneer_wall_w',
    Math.PI / 2,
    'Auctioneer Dunstan Reefholt',
    0x5f8a6a,
    "Blades and bows on this side. Mind the edges, they're sharper than the bidding.",
  ],
  [
    'th_auctioneer_wall_e',
    'auctioneer_wall_e',
    -Math.PI / 2,
    'Auctioneer Maris Oakhollow',
    0x9a6fa8,
    'Rare goods to the east booth. If it glows, it costs extra.',
  ],
];
for (const [id, spot, facing, name, color, greeting] of AUCTIONEERS) {
  if (!report.market?.npcs?.[spot]) continue; // an older sidecar: no spot, no NPC
  if (!list.find((q) => q.id === id)) {
    const rec = {
      id,
      name,
      title: 'Auction House',
      pos: { x: 0, z: 0 },
      facing: 0,
      color,
      questIds: [],
      greeting,
      market: true,
    };
    if (Array.isArray(npcs)) npcs.push(rec);
    else npcs[id] = rec;
    list.push(rec);
    console.log(`  npc ${id} created`);
  }
  seat(id, report.market?.npcs?.[spot], facing, 'market');
}

// Clear the grown footprints: at TOWN_SCALE a building's walls reach over
// what stood beside it (a street lamp, a garden fence, an NPC on the street).
// Anything whose centre falls inside one of a town building's wall boxes
// (sidecar collision, tops over 1 yd) walks straight out from the building's
// centre until it is 0.8 yd clear. The NPCs seated INSIDE on purpose stay.
const SEATED = new Set([
  'th_innkeeper',
  'th_market_folk_4',
  'th_market_reagents',
  'th_market_tonics',
  'th_banker',
  'th_merchant',
  ...AUCTIONEERS.map((a) => a[0]),
]);
const TOWN_RE = /^tidehold\/(house_[a-e]|tavern|tavern_b|smithy|market|hall|shop_[ab]|bank)$/;
const wallBoxes = new Map();
function wallsOf(p) {
  const name = p.assetId.split('/')[1];
  let side = wallBoxes.get(name);
  if (!side) {
    side = JSON.parse(
      fs.readFileSync(
        path.join(root, `tmp/asset_src/tidehold_town/tidehold_${name}.collision.json`),
        'utf8',
      ),
    ).boxes.filter((b) => b.y + b.hy > 1.0);
    wallBoxes.set(name, side);
  }
  const k = (p.scale * 2.2) / report[name].maxDim;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  return side.map((b) => ({
    cx: p.x + (b.x * c + b.z * s) * k,
    cz: p.z + (-b.x * s + b.z * c) * k,
    hx: b.hx * k,
    hz: b.hz * k,
    rot: p.rotY + (b.ry ?? 0),
  }));
}
function insideAny(boxes, x, z, pad) {
  return boxes.some((b) => {
    const dx = x - b.cx;
    const dz = z - b.cz;
    const c = Math.cos(b.rot);
    const s = Math.sin(b.rot);
    return Math.abs(dx * c - dz * s) <= b.hx + pad && Math.abs(dx * s + dz * c) <= b.hz + pad;
  });
}
let cleared = 0;
for (const host of map.placements.filter((p) => TOWN_RE.test(p.assetId))) {
  const boxes = wallsOf(host);
  const movers = [
    ...map.placements
      .filter((q) => q !== host && !TOWN_RE.test(q.assetId))
      .map((q) => ({ o: q, label: q.assetId })),
    ...list.filter((n) => !SEATED.has(n.id)).map((n) => ({ o: n.pos ?? n, label: `npc ${n.id}` })),
  ];
  for (const { o, label } of movers) {
    if (!insideAny(boxes, o.x, o.z, 0.2)) continue;
    let ux = o.x - host.x;
    let uz = o.z - host.z;
    const len = Math.hypot(ux, uz) || 1;
    ux /= len;
    uz /= len;
    let t = 0;
    while (insideAny(boxes, o.x + ux * t, o.z + uz * t, 0.8) && t < 60) t += 0.25;
    console.log(
      `  cleared ${label} ${t.toFixed(2)} yd out of ${host.assetId} (${o.x.toFixed(1)}, ${o.z.toFixed(1)})`,
    );
    o.x = r2(o.x + ux * t);
    o.z = r2(o.z + uz * t);
    cleared++;
  }
}
console.log(
  `${moved} placements re-seated, ${cleared} cleared out of grown footprints${DRY ? ' (dry run)' : ''}`,
);
if (!DRY) fs.writeFileSync(mapPath, JSON.stringify(map)); // the map file is compact, no trailing newline
