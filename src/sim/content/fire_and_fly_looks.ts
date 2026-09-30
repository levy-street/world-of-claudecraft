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
  // A flood of tunnelers to blast, each as light as the digger it stands in for.
  fire_and_fly_deluge: { tunnel_rat: 'deeprock_kobold' },
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
