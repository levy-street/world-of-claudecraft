// Source Cave contributor overrides. Keys are GitHub logins; using lowercase
// keys is recommended because lookup falls back to login.toLowerCase().

export interface SourceCaveMobCustomAttributes {
  /** Display name. Leave absent to use the GitHub login verbatim. */
  name?: string;
  /** Character manifest key, for example player_mage, player_warrior, or mob_bandit. */
  visualKey?: string;
  /** Alternate skin index for visual keys that define skins, mainly player_* models. */
  skin?: number;
  /** Render tint as a hex number, for example 0x8a4cff. */
  color?: number;
  /** Render scale multiplier. Gameplay collision and combat stay unchanged. */
  scale?: number;
  /** Item id rendered as the held mainhand weapon when the visual supports weapons. */
  mainhandItemId?: string;
}

export const SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES: Record<string, SourceCaveMobCustomAttributes> = {
  FernandoX7: {
    name: 'Fernando',
  },
  Rubsey: {
    name: 'The Architect',
  },
  madmatah: {
    name: 'Maaaaaat',
  },
  // Example:
  // mat: {
  //   name: 'Archivist Mat',
  //   visualKey: 'player_mage',
  //   skin: 2,
  //   color: 0x8a4cff,
  //   scale: 1.2,
  //   mainhandItemId: 'gravecaller_staff',
  // },
};

export function sourceCaveMobCustomAttributesForLogin(
  login: string,
): SourceCaveMobCustomAttributes | undefined {
  return (
    SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES[login] ??
    SOURCE_CAVE_MOB_CUSTOM_ATTRIBUTES[login.toLowerCase()]
  );
}
