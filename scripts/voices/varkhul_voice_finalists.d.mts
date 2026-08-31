export type VarkhulFinalistTreatmentId = 'original' | 'deeper' | 'stone-forge';

export interface VarkhulFinalist {
  readonly id: string;
  readonly source: string;
}

export interface VarkhulFinalistTreatment {
  readonly id: VarkhulFinalistTreatmentId;
  readonly label: string;
}

export const VARKHUL_FINALISTS: readonly VarkhulFinalist[];
export const VARKHUL_FINALIST_TREATMENTS: readonly VarkhulFinalistTreatment[];
export const VARKHUL_PRODUCTION_TREATMENT: 'stone-forge';
export function buildVarkhulFinalistFilter(treatmentId: string): string | null;
