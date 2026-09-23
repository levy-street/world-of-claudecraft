export function measureWolfGait(
  input: string,
  sampleCount?: number,
): Promise<{
  normScale: number;
  clips: Array<{
    name: string;
    duration: number;
    airborneFraction: number;
    airborneBodyRise: number;
    airbornePhases: number;
    rows: Array<{
      minY: number;
      rangeY: number;
      stanceN: number;
      stanceMedian: number;
      backwardMax: number;
    }>;
  }>;
}>;
