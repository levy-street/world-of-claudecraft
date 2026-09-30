// Fire and Fly dresses a few monsters in another template's body: the arena keeps
// each template's hit points, speed and size, and borrows only the look
// template's model, tint and voice.
export const FIRE_AND_FLY_MONSTER_LOOKS: Readonly<Record<string, string>> = {
  frostmane_yeti: 'pyre_colossus',
};

export function fireAndFlyLookTemplate(templateId: string): string {
  return FIRE_AND_FLY_MONSTER_LOOKS[templateId] ?? templateId;
}
