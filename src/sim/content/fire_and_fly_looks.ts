// Fire and Fly dresses a few monsters in another template's body: the arena keeps
// each template's hit points, speed and size, and borrows only the look
// template's model, tint and voice.
export const FIRE_AND_FLY_MONSTER_LOOKS: Readonly<Record<string, string>> = {
  frostmane_yeti: 'pyre_colossus',
};

/** Looks for one scenario only, over the ones above. */
export const FIRE_AND_FLY_SCENARIO_LOOKS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // The Wildheart hunt: the tribe's hunters and their beasts, led by a giant old wolf.
  fire_and_fly_pack: {
    tunnel_rat: 'wildheart_stalker',
    deeprock_kobold: 'wildheart_hexcaller',
    vale_bandit: 'wildheart_ravager',
    boneclad_revenant: 'wildheart_beastmaster',
    fen_troll: 'rift_dread_stalker',
    thornpeak_ogre: 'rift_thornback',
    frostmane_yeti: 'old_greyjaw',
  },
  // A flood of tunnelers to blast, each as light as the digger it stands in for.
  fire_and_fly_deluge: { tunnel_rat: 'deeprock_kobold' },
  // The dead rise against a cracked tower, shadow hounds at their heels.
  fire_and_fly_brittle: {
    wild_boar: 'rift_dread_stalker',
    tunnel_rat: 'restless_bones',
    deeprock_kobold: 'crypt_shambler',
    vale_bandit: 'hollow_acolyte',
  },
  // The forge's own come for the powder, a sack-thief among them.
  fire_and_fly_powder: {
    tunnel_rat: 'emberkin',
    deeprock_kobold: 'ignivar_cinder_artificer',
    vale_bandit: 'hoard_coinsack_scurrier',
    boneclad_revenant: 'rift_ember_fiend',
    fen_troll: 'ignivar_crucible_warden',
    thornpeak_ogre: 'rift_magma_brute',
  },
};

export function fireAndFlyLookTemplate(templateId: string, scenarioId: string): string {
  return (
    FIRE_AND_FLY_SCENARIO_LOOKS[scenarioId]?.[templateId] ??
    FIRE_AND_FLY_MONSTER_LOOKS[templateId] ??
    templateId
  );
}

/** A rig's identity: its template, plus the body it borrows when it borrows one. */
export function fireAndFlyRigId(templateId: string, scenarioId: string): string {
  const look = fireAndFlyLookTemplate(templateId, scenarioId);
  return look === templateId ? templateId : `${templateId}>${look}`;
}
