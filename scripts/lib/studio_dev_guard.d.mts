export const STUDIO_DEV_ROUTE_PREFIXES: readonly string[];

export function isStudioDevRoute(url: string | undefined): boolean;

export interface StudioDevRequest {
  method?: string;
  url?: string;
  remoteAddress?: string;
  origin?: string;
  host?: string;
}

export function studioDevRequestAllowed(req: StudioDevRequest): boolean;

export interface StudioDevGuardReq {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string };
  headers?: { origin?: string | string[]; host?: string | string[] };
}

export interface StudioDevGuardRes {
  statusCode: number;
  end(body?: string): void;
}

export function studioDevGuardMiddleware(
  req: StudioDevGuardReq,
  res: StudioDevGuardRes,
  next: () => void,
): void;
