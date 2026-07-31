export const ONLINE_WORLD_AUTH_TYPE: 'auth-world-3';

export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE: 'Game and server versions are incompatible. Reload or update, then try again.';

export interface WorldAuthMessage {
  readonly t: typeof ONLINE_WORLD_AUTH_TYPE;
  readonly token: string;
  readonly character: number;
}

export function worldAuthMessage(token: string, character: number): WorldAuthMessage;
