export interface RickshawMaterialContractEntry {
  readonly name: string;
  readonly surface: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly uvScale: number;
}

export const RICKSHAW_MATERIAL_CONTRACT: readonly RickshawMaterialContractEntry[];
