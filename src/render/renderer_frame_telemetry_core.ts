export interface RendererFramePhaseMs {
  setup: number;
  entities: number;
  world: number;
  nameplates: number;
  submit: number;
  total: number;
}

export interface RendererWorldPhaseMs {
  lights: number;
  water: number;
  terrain: number;
  props: number;
  foliage: number;
  fish: number;
  ambientScenery: number;
  zoneVisibility: number;
  zoneFeatures: number;
  vfx: number;
  camera: number;
  ambience: number;
  shadows: number;
  sky: number;
  sunSprites: number;
  godRays: number;
}

export interface RendererFrameTimingSink {
  submitMs: number;
  totalMs: number;
}

export function beginRendererFrameTelemetry(
  framePhaseMs: RendererFramePhaseMs,
  worldPhaseMs: RendererWorldPhaseMs,
  timingSink: RendererFrameTimingSink,
): void {
  timingSink.submitMs = framePhaseMs.submit;
  timingSink.totalMs = framePhaseMs.total;

  framePhaseMs.setup = 0;
  framePhaseMs.entities = 0;
  framePhaseMs.world = 0;
  framePhaseMs.nameplates = 0;
  framePhaseMs.submit = 0;
  framePhaseMs.total = 0;

  worldPhaseMs.lights = 0;
  worldPhaseMs.water = 0;
  worldPhaseMs.terrain = 0;
  worldPhaseMs.props = 0;
  worldPhaseMs.foliage = 0;
  worldPhaseMs.fish = 0;
  worldPhaseMs.ambientScenery = 0;
  worldPhaseMs.zoneVisibility = 0;
  worldPhaseMs.zoneFeatures = 0;
  worldPhaseMs.vfx = 0;
  worldPhaseMs.camera = 0;
  worldPhaseMs.ambience = 0;
  worldPhaseMs.shadows = 0;
  worldPhaseMs.sky = 0;
  worldPhaseMs.sunSprites = 0;
  worldPhaseMs.godRays = 0;
}
