export interface MeshPlanProblemReport {
  problems: string[];
  stats: {
    triangles: number;
    measured: { length: number; beam: number; height: number; keelY: number };
    deckProbes: number;
    supported: number;
    blocked: number;
    holes: number;
  };
}

export function verifyPlanAgainstMesh(
  triangles: readonly (readonly (readonly number[])[])[],
  plan: unknown,
  options?: {
    boundsEpsilon?: number;
    surfaceTolerance?: number;
    probeStep?: number;
    headroom?: number;
    furnitureCeiling?: number;
    railBackingFloor?: number;
  },
): MeshPlanProblemReport;
