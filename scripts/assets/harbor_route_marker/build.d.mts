export interface HarborRouteMarkerAssetSpec {
  source: string;
  target: string;
  inputs: readonly string[];
  requiredNodes: readonly string[];
  materials: readonly string[];
  /** The painted base-colour map each textured material wears, by material name. */
  maps: Readonly<Record<string, string>>;
  maxMapSize: number;
  mapSizes: Readonly<Record<string, number>>;
}
export const HARBOR_ROUTE_MARKER_ASSET: HarborRouteMarkerAssetSpec;
export function sourceFingerprint(asset?: HarborRouteMarkerAssetSpec, root?: string): string;
export function buildHarborRouteMarker(
  asset?: HarborRouteMarkerAssetSpec,
  root?: string,
): Promise<Uint8Array>;
