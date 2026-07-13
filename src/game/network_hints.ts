/** Network client hints that are safe to read before the game renderer loads. */
interface NetworkInformationWithSaveData {
  readonly saveData?: boolean;
}

type NavigatorWithSaveData = Navigator & {
  readonly connection?: NetworkInformationWithSaveData;
  readonly mozConnection?: NetworkInformationWithSaveData;
  readonly webkitConnection?: NetworkInformationWithSaveData;
};

/** Typed read of the Save-Data client hint (the user asked to conserve data). */
export function navigatorSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithSaveData;
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return !!connection?.saveData;
}
