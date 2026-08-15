// Hand-written declarations for electron/epic.cjs so the Vitest suite
// type-checks its imports (same convention as the other electron/*.d.cts
// files). Keep in sync with the .cjs exports.

export interface EpicIds {
  productId: string;
  deploymentId: string;
  clientId: string;
}

export interface EpicProofHandle {
  proof: string;
  cancel?: () => void;
}

export interface EpicShellInput {
  distribution?: string;
  packagedMetadata?: {
    wocDesktop?: {
      epicProductId?: string;
      epicDeploymentId?: string;
      epicClientId?: string;
    };
  } | null;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
  log?: { warn?: (...args: unknown[]) => void };
  requireEos?: () => {
    init: (ids: EpicIds) => {
      getLinkProof?: () => Promise<string | EpicProofHandle | null>;
    } | null;
  };
  readArgv?: () => string[];
}

export interface EpicShell {
  enabled: boolean;
  productId: string;
  deploymentId: string;
  clientId: string;
  getLinkProof(): Promise<string | null>;
  cancelLinkProof(): void;
}

export function parseLauncherExchangeCode(argv: unknown): string | null;

export function epicIntegrationEnabled(input?: {
  distribution?: string;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}): boolean;

export function resolveEpicIds(input?: {
  packagedMetadata?: {
    wocDesktop?: {
      epicProductId?: string;
      epicDeploymentId?: string;
      epicClientId?: string;
    };
  } | null;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}): EpicIds;

export function createEpicShell(input?: EpicShellInput): EpicShell;
