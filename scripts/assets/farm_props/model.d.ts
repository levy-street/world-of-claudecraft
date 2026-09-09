import type { Group } from 'three';

export interface FarmPropContract {
  readonly id: string;
  readonly out: string;
  readonly rootNode: string;
  readonly family: string;
  readonly stage: string;
  readonly footprintYd: readonly [number, number];
  readonly pivot: string;
  readonly heightYd: number;
  readonly meshes: readonly string[];
  readonly materials: readonly string[];
  readonly sockets: Readonly<Record<string, string>>;
  readonly mountsOn: string | null;
  readonly tintChannels: Readonly<Record<string, string>>;
}

export const FARM_BODY_MESH_NODE: string;
export const FARM_ACCENT_MESH_NODE: string;
export const FARM_BODY_MATERIAL: string;
export const FARM_ACCENT_MATERIAL: string;
export const FARM_SOIL_SOCKET_NODE: string;
export const FARM_PROP_CONTRACTS: Readonly<Record<string, FarmPropContract>>;
export const FARM_PROP_IDS: readonly string[];
export function createFarmProp(id: string): Group;
