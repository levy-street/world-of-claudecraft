import { MAX_LOADOUTS } from '../../src/sim/content/talents';

export function talentLoadoutGuide(): string {
  return [
    '== Saved builds and loadouts ==',
    'A saved build remembers your specialization, talent choices and action bars. You can also save the gear you are wearing. Each character can keep up to ' +
      MAX_LOADOUTS +
      ' named builds. It is free: you do not need a trainer, an item or any money.',
    '=== Save a build ===',
    '# Leave combat, and finish any arena match first. Press N to open Talents. Set up the specialization, talents and action bars you want to keep.',
    '# Open the build dropdown at the bottom left. It shows the name of your saved build, or Default Loadout if none is picked. Choose New build. To also save the gear you are wearing, choose New Build (save gear too) instead.',
    '# In Save build, type a name under Name this build: and select Save. Names are cut to 24 characters. If you use a name you already have, that build is replaced.',
    '# To update your active saved build later, use Save or Save current. A normal update keeps the gear you saved before. To replace its saved gear with what you are wearing now, use New Build (save gear too) with the same name.',
    '=== Switch builds ===',
    '# Make sure you are out of combat and not in an arena match. Open the dropdown in Talents and click the saved build you want.',
    '# Your specialization, talent choices and action bars change to that build. If the build has gear, the game also tries to put on those exact items from what you are wearing or from your bags.',
    '# Read any messages about missing items or gear you cannot use. Missing or unusable gear does not stop the switch. Your talents still change, and the rest of the gear still goes on. Gear kept anywhere else must be moved to your bags first.',
    'You can switch builds in a battleground while you are out of combat. In an arena match you cannot switch at all, even between fights.',
    '=== Share, import and delete ===',
    'Export copies a build string. It copies the selected build, or your current choices if no saved build is selected. The string has your class and talent choices. It does not include gear or action bars. Import takes a build string for your own class and applies its talent choices. Save it afterward if you want to keep it as a named build.',
    'To delete a build, open the build dropdown at the bottom left. Click the X beside its name, then choose Delete build in the Delete saved build? box. If you delete your active build, the game can switch you to the talent choices of the next remaining build. If it was your last saved build, you keep your current talent choices. Check your choices after you delete an active build.',
  ].join('\n\n');
}
