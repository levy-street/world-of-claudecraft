// Dev-only console teleports for walking the realms quickly: installs a
// window.go object so pasting `go.frost()` in the devtools console jumps
// the OFFLINE character to that realm's town hub (healed, so arrival never
// lands a dead tester). main.ts installs it only when import.meta.env.DEV
// and the session is offline: production builds and online sessions never
// see it (a free teleport is a movement cheat). All console output here is
// dev-channel text, intentionally not localized.

export interface DevTeleportZone {
  id: string;
  town: string;
  x: number;
  z: number;
}

// Short console-friendly aliases for the shipped zone ids; an unknown id
// (a future zone) falls back to its full id so it still gets a shortcut.
const ZONE_ALIASES: Record<string, string> = {
  eastbrook_vale: 'vale',
  mirefen_marsh: 'marsh',
  thornpeak_heights: 'peaks',
  veiled_hollow: 'hollow',
  drakelands: 'drake',
  frostveil: 'frost',
  amberfall: 'amber',
  willowfen: 'fen',
  nightbloom: 'night',
  wraithwood: 'wood',
  palmreach: 'palm',
  evergarden: 'garden',
  galecrest: 'gale',
  farshore_isle: 'isle',
};

export function installDevTeleports(
  zones: DevTeleportZone[],
  teleport: (x: number, z: number) => void,
): void {
  const go: Record<string, () => string> = {};
  for (const zn of zones) {
    const key = ZONE_ALIASES[zn.id] ?? zn.id;
    go[key] = () => {
      teleport(zn.x, zn.z);
      console.log(`Teleported to ${zn.town} (${zn.x}, ${zn.z})`);
      return zn.town;
    };
  }
  (window as unknown as { go: typeof go }).go = go;
  console.log(
    `Realm teleports ready (offline dev only): ${Object.keys(go)
      .map((k) => `go.${k}()`)
      .join(' ')}`,
  );
}
