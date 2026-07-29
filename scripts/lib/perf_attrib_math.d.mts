export interface AttributionMetrics {
  fps: number;
  deltaFps: number;
  gpuMsSaved: number;
}

export interface AttributionSample {
  knob: string;
  fps: number;
}

export declare function frameTimeMs(fps: number): number;
export declare function attributionMetrics(
  controlFps: number,
  sampleFps: number,
): AttributionMetrics;
export declare function formatAttributionTable(
  controlFps: number,
  samples: ReadonlyArray<AttributionSample>,
): string;
