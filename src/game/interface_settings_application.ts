import type { GameSettings } from './settings';

export interface InterfaceSettingStyle {
  setProperty(name: string, value: string): void;
}

export interface InterfaceSettingClassList {
  toggle(name: string, force?: boolean): unknown;
}

export interface InterfaceSettingElement {
  classList: InterfaceSettingClassList;
}

export interface InterfaceSettingsHost {
  rootStyle: InterfaceSettingStyle;
  bodyClassList: InterfaceSettingClassList;
  getElementById(id: string): InterfaceSettingElement | null;
  setLockPlayerFrameToActionBar(locked: boolean): void;
}

/** Apply the live presentation side of settings owned by the interface editor.
 *  Persistence stays with the caller so this adapter only coordinates the DOM
 *  and HUD effects that need to happen immediately. */
export function applyInterfaceSetting(
  key: keyof GameSettings,
  value: number | boolean,
  host: InterfaceSettingsHost,
): boolean {
  switch (key) {
    case 'playerFrameScale':
      host.rootStyle.setProperty('--player-frame-scale', String(value));
      return true;
    case 'targetFrameScale':
      host.rootStyle.setProperty('--target-frame-scale', String(value));
      return true;
    case 'playerFrameWidth':
      host.rootStyle.setProperty('--player-frame-width', `${value}px`);
      return true;
    case 'playerFrameHeight':
      host.rootStyle.setProperty('--player-frame-height', `${value}px`);
      return true;
    case 'targetFrameWidth':
      host.rootStyle.setProperty('--target-frame-width', `${value}px`);
      return true;
    case 'targetFrameHeight':
      host.rootStyle.setProperty('--target-frame-height', `${value}px`);
      return true;
    case 'partyFrameScale':
      host.rootStyle.setProperty('--party-frame-scale', String(value));
      return true;
    case 'partyFrameWidth':
      host.rootStyle.setProperty('--party-frame-width', `${value}px`);
      return true;
    case 'partyFrameHeight':
      host.rootStyle.setProperty('--party-frame-height', `${value}px`);
      return true;
    case 'partyFrameSpacing':
      host.rootStyle.setProperty('--party-frame-spacing', `${value}px`);
      return true;
    case 'partyFrameColumns':
      host.rootStyle.setProperty('--party-frame-columns', String(Math.round(Number(value))));
      return true;
    case 'buffsLeftToRight':
      host.rootStyle.setProperty('--buff-bar-direction', value ? 'row' : 'row-reverse');
      return true;
    case 'debuffsLeftToRight':
      host.rootStyle.setProperty('--debuff-bar-direction', value ? 'row' : 'row-reverse');
      return true;
    case 'lockPlayerFrameToActionBar':
      host.setLockPlayerFrameToActionBar(Boolean(value));
      return true;
    case 'actionBar1Vertical':
      host.getElementById('actionbar')?.classList.toggle('bar-vertical', Boolean(value));
      host.bodyClassList.toggle('combined-bars-vertical', Boolean(value));
      return true;
    case 'actionBar2Vertical':
      host.getElementById('actionbar2')?.classList.toggle('bar-vertical', Boolean(value));
      return true;
    case 'actionBar3Vertical':
      host.getElementById('actionbar3')?.classList.toggle('bar-vertical', Boolean(value));
      return true;
    case 'menuRailHorizontal':
      host.bodyClassList.toggle('menu-rail-horizontal', Boolean(value));
      return true;
    case 'frameSnapToGrid':
      // MovableFrame reads this setting at drag time. Persistence is the only
      // immediate work, but recognizing it keeps the editor-owned arm together.
      return true;
    default:
      return false;
  }
}
