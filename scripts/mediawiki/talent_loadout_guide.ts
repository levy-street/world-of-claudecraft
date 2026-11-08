import { MAX_LOADOUTS } from '../../src/sim/content/talents';

export function talentLoadoutGuide(): string {
  return [
    '== Saved builds and loadouts ==',
    'A saved build stores your specialization, talent choices and action bars. You can optionally save your equipped gear as well. You can keep up to ' +
      MAX_LOADOUTS +
      ' named builds per character. No trainer, item or currency payment is required.',
    '=== Save a build ===',
    '# Leave combat and finish any arena match. Press N to open Talents and choose the specialization, talents and action bars you want to keep.',
    '# Open the build dropdown at the bottom left. It shows your saved build name, or Default Loadout if none is selected. Choose New build, or New Build (save gear too) to include your currently equipped items.',
    '# In Save build, enter a name under Name this build: and select Save. Names are trimmed to 24 characters. Using an existing name overwrites that build.',
    '# To update your active saved build later, use Save or Save current. An ordinary update preserves previously saved gear; use New Build (save gear too) with the same name to replace its saved gear with what you are wearing now.',
    '=== Switch builds ===',
    '# While out of combat and outside an arena match, open the dropdown in Talents and click the saved build you want.',
    '# Your specialization, talent choices and action bars change to that build. If it includes gear, the game also tries to equip those exact item copies from your current equipment or bags.',
    '# Read any missing-item or equip-requirement messages. Missing or unusable gear does not stop the talent change or the remaining usable gear from being applied. Gear stored elsewhere must be retrieved first.',
    'Out-of-combat switching is allowed in a battleground. An arena match blocks switching even between fights.',
    '=== Share, import and delete ===',
    'Export copies a build string for the selected build, or your current choices if no saved build is selected. It contains your class and talent choices; it does not include gear or action bars. Import accepts a build string for your own class and applies its talent choices. Save it afterward if you want a named loadout.',
    'To delete a build, open the bottom-left build dropdown, click the X beside its name, then choose Delete build in the Delete saved build? dialog. Deleting the active build can apply the next remaining build’s talent choices. If it was your last saved build, your current talent choices remain. Check your choices after deleting an active build.',
  ].join('\n\n');
}
