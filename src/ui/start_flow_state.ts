export type StartFlowPanel =
  | '#mode-select'
  | '#login-panel'
  | '#realm-panel'
  | '#charselect-panel'
  | '#offline-select'
  | 'none';

export type StartFlowState =
  | 'mode-select'
  | 'login'
  | 'authenticating'
  | 'realm-loading'
  | 'realm-list'
  | 'realm-empty'
  | 'offline-select'
  | 'character-loading'
  | 'character-empty'
  | 'character-select'
  | 'character-error'
  | 'world-connecting'
  | 'game-ready';

export interface StartFlowSnapshot {
  state: StartFlowState;
  panel: StartFlowPanel;
  hasGame: boolean;
  username?: string;
  realm?: string;
  characterCount?: number;
  error?: string;
}

function realmSuffix(realm: string | undefined): string {
  return realm ? ` on ${realm}` : '';
}

export function startFlowStatusText(snapshot: StartFlowSnapshot): string {
  switch (snapshot.state) {
    case 'mode-select':
      return 'Choose online or offline play.';
    case 'login':
      return 'Online: enter your account details.';
    case 'authenticating':
      return 'Online: signing in...';
    case 'realm-loading':
      return 'Online: loading realms...';
    case 'realm-list':
      return snapshot.username ? `Online: ${snapshot.username}, choose a realm.` : 'Online: choose a realm.';
    case 'realm-empty':
      return 'Online: no realms are available.';
    case 'offline-select':
      return 'Offline: create a local character.';
    case 'character-loading':
      return `Online: loading characters${realmSuffix(snapshot.realm)}...`;
    case 'character-empty':
      return `Online: no characters${realmSuffix(snapshot.realm)} yet.`;
    case 'character-select':
      if (snapshot.characterCount === 1) return `Online: 1 character available${realmSuffix(snapshot.realm)}.`;
      if (typeof snapshot.characterCount === 'number') {
        return `Online: ${snapshot.characterCount} characters available${realmSuffix(snapshot.realm)}.`;
      }
      return `Online: characters available${realmSuffix(snapshot.realm)}.`;
    case 'character-error':
      return snapshot.error ? `Online: could not load characters: ${snapshot.error}` : 'Online: could not load characters.';
    case 'world-connecting':
      return `Online: entering the world${realmSuffix(snapshot.realm)}...`;
    case 'game-ready':
      return 'World ready.';
  }
}
