import * as THREE from 'three';

export const FENBRIDGE_SURFACE_ATLAS_SIZE = 512;
export const FENBRIDGE_SURFACE_ANISOTROPY = 4;
export const FENBRIDGE_SURFACE_NORMAL_SCALE = 0.82;
export const FENBRIDGE_SURFACE_WORLD_SPAN = 12;
export const FENBRIDGE_SURFACE_RESPONSE_CHANNELS = Object.freeze({
  roughness: 'green',
  metalness: 'blue',
});

export const FENBRIDGE_SURFACE_CELLS = Object.freeze({
  mossStone: 0,
  cleanStone: 1,
  darkTimber: 2,
  warmTimber: 3,
  tealShingles: 4,
  forgedIron: 5,
  agedBrass: 6,
  rope: 7,
  tealCanvas: 8,
  parchment: 9,
  curedHide: 10,
  packedMud: 11,
  tealFenlight: 12,
  potionGlass: 13,
  rawBoard: 14,
  redWax: 15,
});

export type FenbridgeSurfaceSemantic = keyof typeof FENBRIDGE_SURFACE_CELLS;
type SemanticAtVertex = FenbridgeSurfaceSemantic | ((index: number) => FenbridgeSurfaceSemantic);

const ATLAS_COLUMNS = 4;
const CELL_PADDING_UV = 4 / FENBRIDGE_SURFACE_ATLAS_SIZE;
const CELL_SIZE_UV = 1 / ATLAS_COLUMNS;

function centeredWorldUv(value: number): number {
  return THREE.MathUtils.clamp(value / FENBRIDGE_SURFACE_WORLD_SPAN + 0.5, 0, 1);
}

function elevatedWorldUv(value: number): number {
  return THREE.MathUtils.clamp(value / FENBRIDGE_SURFACE_WORLD_SPAN, 0, 1);
}

function cellUv(
  semantic: FenbridgeSurfaceSemantic,
  localU: number,
  localV: number,
): readonly [number, number] {
  const cell = FENBRIDGE_SURFACE_CELLS[semantic];
  const column = cell % ATLAS_COLUMNS;
  const rowFromTop = Math.floor(cell / ATLAS_COLUMNS);
  const usable = CELL_SIZE_UV - CELL_PADDING_UV * 2;
  return [
    column * CELL_SIZE_UV + CELL_PADDING_UV + localU * usable,
    1 - (rowFromTop + 1) * CELL_SIZE_UV + CELL_PADDING_UV + localV * usable,
  ];
}

/** Clone loader-owned geometry and synthesize one atlas-cell UV per vertex. */
export function fenbridgeSurfaceGeometry(
  source: THREE.BufferGeometry,
  semanticAtVertex: SemanticAtVertex,
): THREE.BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Fenbridge surface geometry requires positions');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }
  const uv = new Float32Array(position.count * 2);

  for (let index = 0; index < position.count; index++) {
    const nx = Math.abs(normal.getX(index));
    const ny = Math.abs(normal.getY(index));
    const nz = Math.abs(normal.getZ(index));
    let localU: number;
    let localV: number;
    if (nx >= ny && nx >= nz) {
      localU = centeredWorldUv(position.getZ(index));
      localV = elevatedWorldUv(position.getY(index));
    } else if (ny >= nz) {
      localU = centeredWorldUv(position.getX(index));
      localV = centeredWorldUv(position.getZ(index));
    } else {
      localU = centeredWorldUv(position.getX(index));
      localV = elevatedWorldUv(position.getY(index));
    }
    const semantic =
      typeof semanticAtVertex === 'function' ? semanticAtVertex(index) : semanticAtVertex;
    const atlasUv = cellUv(semantic, localU, localV);
    uv[index * 2] = atlasUv[0];
    uv[index * 2 + 1] = atlasUv[1];
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// Full exporter palette authority. Shade variants must retain the material
// family they were authored for: nearest lookup against only the sixteen cell
// base colors would, for example, classify deep teal roofing as forged iron.
export const FENBRIDGE_EXPORTER_PALETTE_SEMANTICS = Object.freeze({
  stoneDeep: [0x2e3431, 'mossStone'],
  stone: [0x4e5650, 'mossStone'],
  stoneLight: [0x74776b, 'cleanStone'],
  moss: [0x59613a, 'mossStone'],
  timberDeep: [0x1d1713, 'darkTimber'],
  timberDark: [0x34271e, 'darkTimber'],
  timber: [0x523b29, 'warmTimber'],
  timberLight: [0x765236, 'rawBoard'],
  roofDeep: [0x103a3c, 'tealShingles'],
  roof: [0x176269, 'tealShingles'],
  roofLight: [0x2d8585, 'tealShingles'],
  iron: [0x34383a, 'forgedIron'],
  ironLight: [0x62676a, 'forgedIron'],
  brass: [0x9b762d, 'agedBrass'],
  brassLight: [0xd1a952, 'agedBrass'],
  clothTeal: [0x276a6f, 'tealCanvas'],
  rope: [0x8d7650, 'rope'],
  parchment: [0xd3be8c, 'parchment'],
  parchmentDark: [0xa58a5f, 'parchment'],
  hide: [0x9e7449, 'curedHide'],
  mud: [0x604c36, 'packedMud'],
  potionGlass: [0x6269a5, 'potionGlass'],
  herb: [0x587b3d, 'mossStone'],
  wax: [0xa42632, 'redWax'],
  water: [0x194d59, 'potionGlass'],
  // Low folds the emissive primitive into its atlas-colored Lambert pass, so
  // warm lamps use the gold/brass cell while cyan fenlight keeps its own cell.
  warm: [0xffa43a, 'agedBrass'],
  warmBright: [0xffdd77, 'agedBrass'],
  fenlight: [0x30e4d1, 'tealFenlight'],
  fenlightPale: [0x90fff0, 'tealFenlight'],
} as const satisfies Readonly<Record<string, readonly [number, FenbridgeSurfaceSemantic]>>);

const PALETTE = Object.values(FENBRIDGE_EXPORTER_PALETTE_SEMANTICS).map(([hex, semantic]) => ({
  color: new THREE.Color(hex),
  semantic,
}));

export function fenbridgeSemanticForColor(
  red: number,
  green: number,
  blue: number,
): FenbridgeSurfaceSemantic {
  let best = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of PALETTE) {
    const dr = red - candidate.color.r;
    const dg = green - candidate.color.g;
    const db = blue - candidate.color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best.semantic;
}
