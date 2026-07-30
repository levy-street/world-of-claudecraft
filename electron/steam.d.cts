// Hand-written declarations for electron/steam.cjs so the Vitest suite
// type-checks its imports (same convention as the other electron/*.d.cts
// files). Keep in sync with the .cjs exports.

export const SPACEWAR_APP_ID: number;
export const LINK_TICKET_IDENTITY: string;

export interface SteamShellInput {
  distribution?: string;
  packagedMetadata?: { wocDesktop?: { steamAppId?: number | string } } | null;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
  log?: { warn?: (...args: unknown[]) => void };
  requireSteamworks?: () => {
    init: (appId: number) => {
      auth?: {
        getAuthTicketForWebApi?: (
          identity: string,
        ) => Promise<{ getBytes?: () => Buffer | null; cancel?: () => void } | null>;
      };
    };
  };
}

export interface SteamShell {
  enabled: boolean;
  appId: number;
  getLinkTicket(): Promise<string | null>;
  cancelLinkTicket(): void;
}

export function steamIntegrationEnabled(input?: {
  distribution?: string;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}): boolean;

export function resolveSteamAppId(input?: {
  packagedMetadata?: { wocDesktop?: { steamAppId?: number | string } } | null;
  env?: Record<string, string | undefined>;
  isPackaged?: boolean;
}): number;

export function createSteamShell(input?: SteamShellInput): SteamShell;
