export interface HostDiagSourceFile {
  name: string;
  text: string;
}

export interface HostDiagInputs {
  orchestrator?: string;
  csFiles?: HostDiagSourceFile[];
  libPsFiles?: HostDiagSourceFile[];
  collectorPsFiles?: HostDiagSourceFile[];
}

export interface HostDiagMeta {
  toolVersion: string;
  schemaVersion: number;
}

export declare const INCLUDES_HEADER: string;
export declare function toCrlf(text: string): string;
export declare function sortByName<T extends { name: string }>(files: readonly T[]): T[];
export declare function parseHostDiagMeta(orchestrator: string): HostDiagMeta;
export declare function buildIncludesRegion(inputs?: Omit<HostDiagInputs, 'orchestrator'>): string;
export declare function bundleHostDiag(inputs?: HostDiagInputs): string;
export declare function toShippedBytes(text: string): Buffer;
export declare function sha256Hex(data: Buffer | string): string;
