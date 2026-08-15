export interface GlbClassification {
  images: number;
  convertible: number;
  hadMeshopt: boolean;
  skip: boolean;
}

export interface GlbStructuralSnapshot {
  skins: number;
  animations: number;
  meshes: number;
  nodes: number;
  nodesWithExtras: number;
  hasAssetExtras: boolean;
}

export interface GlbJson {
  images?: { mimeType?: string }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  skins?: unknown[];
  animations?: unknown[];
  meshes?: unknown[];
  nodes?: { extras?: unknown }[];
  asset?: { extras?: unknown };
}

export function glbJsonChunk(buf: Buffer): GlbJson;
export function classifyGlb(json: GlbJson): GlbClassification;
export function structuralSnapshot(json: GlbJson): GlbStructuralSnapshot;
export function snapshotMismatch(
  before: GlbStructuralSnapshot,
  after: GlbStructuralSnapshot,
): string[] | null;
export function weaponVfxModelKeys(source: string): string[];
