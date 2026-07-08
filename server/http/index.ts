// Public-surface barrel for the API request pipeline spine (server/http/).
//
// Re-exports the public spine surface: the table router, the middleware onion
// (compose) + context, the schema validator, the error model (errors +
// error_codes), the registry, and the dispatcher, plus the frozen shared types
// (type-only). One stable import point for the whole spine; server/main.ts and
// the tests import the individual modules directly, which is equally supported.
//
// Intentionally NOT re-exported: the private internals that consumers reach
// through a seam rather than by name. path_pattern.ts (the router's own no-regex
// compiler), config.ts (loadConfig is read where the server boots, not via the
// barrel), client_error.ts (the socket clienterror hook), and the individual
// middleware/*.ts primitives (composed by the dispatcher, not imported piecemeal).
// Excluding path_pattern also keeps its HttpMethod alias out of the barrel, so
// there is no HttpMethod-vs-Method name clash to disambiguate.
//
// Every module below declares each exported name exactly once and no two of them
// export the same name, so a plain `export *` is unambiguous; ./types is a
// type-only module re-exported with `export type *`.

export * from './compose';
export * from './context';
export * from './dispatch';
export * from './error_codes';
export * from './errors';
export * from './registry';
export * from './router';
export * from './schema';
export type * from './types';
