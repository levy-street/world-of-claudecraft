export const ONLINE_WORLD_AUTH_TYPE: 'auth-world-3';

export interface WorldAuthMessage {
  readonly t: typeof ONLINE_WORLD_AUTH_TYPE;
  readonly token: string;
  readonly character: number;
}

export function worldAuthMessage(token: string, character: number): WorldAuthMessage;
