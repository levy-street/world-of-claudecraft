export interface ShaderPair {
  vertex: string;
  fragment: string;
}
export type Ablation = (pair: ShaderPair) => ShaderPair | null;
export const ABLATIONS: Record<string, Ablation>;
export function wornTriRSpan(fragment: string): { start: number; end: number } | null;
export function pickPrograms<T extends { hash: string }>(
  programs: T[],
  accept: (program: T) => boolean,
  count: number,
): T[];
