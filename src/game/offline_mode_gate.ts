// Pure decision for whether the homepage offline mode entry points (the
// mode-select dropdown option and its #btn-offline compat trigger) may be
// used. Offline mode runs a local, unauthenticated Sim with no server
// authority, so it is a dev/local-testing convenience only: production
// builds must not expose it. `isDev` is meant to be `import.meta.env.DEV`,
// Vite's standard dev/production flag (true under `npm run dev`, false in a
// production `vite build`).
export function isOfflineModeAvailable(isDev: boolean): boolean {
  return isDev;
}
