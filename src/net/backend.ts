export type WorldBackend = 'node' | 'spacetimedb';

type BackendEnv = {
  VITE_WORLD_BACKEND?: string;
  VITE_STDB_URI?: string;
  VITE_STDB_MODULE?: string;
};

export const DEFAULT_WORLD_BACKEND: WorldBackend = 'node';
export const DEFAULT_STDB_URI = 'http://127.0.0.1:3000';
export const DEFAULT_STDB_MODULE = 'worldofclaudecraft';

function viteEnv(): BackendEnv {
  return ((import.meta as ImportMeta & { env?: BackendEnv }).env ?? {});
}

export function selectedWorldBackend(env: BackendEnv = viteEnv()): WorldBackend {
  return env.VITE_WORLD_BACKEND?.trim().toLowerCase() === 'spacetimedb'
    ? 'spacetimedb'
    : DEFAULT_WORLD_BACKEND;
}

export interface SpacetimeConnectionConfig {
  uri: string;
  moduleName: string;
}

export function spacetimeConnectionConfig(env: BackendEnv = viteEnv()): SpacetimeConnectionConfig {
  return {
    uri: env.VITE_STDB_URI?.trim() || DEFAULT_STDB_URI,
    moduleName: env.VITE_STDB_MODULE?.trim() || DEFAULT_STDB_MODULE,
  };
}
