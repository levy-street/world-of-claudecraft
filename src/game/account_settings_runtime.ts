// Import-time readers need an explicit refresh after account preferences load.
import { interfaceModeFromSetting, setInterfaceMode } from './mobile_controls';
import { music } from './music';
import { Settings } from './settings';

export function refreshAccountSettingsRuntime(): void {
  setInterfaceMode(interfaceModeFromSetting(new Settings().get('interfaceMode')));
  try {
    music.setEnabled(localStorage.getItem('ev_music_on') !== '0');
  } catch {
    music.setEnabled(true);
  }
}
