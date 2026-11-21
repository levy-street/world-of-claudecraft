// The Masterless Strength raid bots' boss module (heart_raid_final.mjs): its
// hooks take the harness's loose world and state objects.
type Loose = Record<string, unknown>;

declare const final: {
  key: string;
  title: string;
  read(world: unknown): void;
  track(world: unknown, st: Loose): void;
  duty(world: unknown, st: Loose, b: unknown, me: unknown): unknown;
  bad(world: unknown, st: Loose, at: { x: number; z: number }): boolean;
  hazards(world: unknown, st: Loose, b: unknown, me: unknown): unknown[];
  summary(world: unknown, st: Loose): Record<string, unknown>;
  [hook: string]: unknown;
};
export default final;
