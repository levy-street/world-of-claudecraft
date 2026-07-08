function sampleBits(): number {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 0;
    let bits = 0;
    if (navigator.webdriver === true) bits |= 1;
    if (Object.getOwnPropertyDescriptor(navigator, 'webdriver') !== undefined) {
      bits |= 2;
    } else if (!('webdriver' in navigator)) {
      bits |= 4;
    } else {
      const proto = Object.getPrototypeOf(navigator);
      const d = proto ? Object.getOwnPropertyDescriptor(proto, 'webdriver') : undefined;
      const native =
        d &&
        typeof d.get === 'function' &&
        Function.prototype.toString.call(d.get).includes('[native code]');
      if (!native) bits |= 8;
    }
    return bits;
  } catch {
    return 0;
  }
}

const earlyBits = sampleBits();

export function clientEnvBits(): number {
  return earlyBits | sampleBits();
}

interface PageStateDoc {
  hasFocus(): boolean;
  readonly visibilityState: DocumentVisibilityState;
}

let stateDoc: PageStateDoc | null = null;
let sawFocus = true;

export function installPageStateTracking(target: EventTarget, doc: PageStateDoc): () => void {
  try {
    stateDoc = doc;
    sawFocus = doc.hasFocus();
    const onFocus = (): void => {
      sawFocus = true;
    };
    target.addEventListener('focus', onFocus);
    return () => {
      target.removeEventListener('focus', onFocus);
      stateDoc = null;
      sawFocus = true;
    };
  } catch {
    return () => {};
  }
}

export function pageStateBits(): number {
  try {
    if (!stateDoc) return 0;
    let bits = 0;
    if (stateDoc.visibilityState === 'hidden') bits |= 1;
    if (!sawFocus) bits |= 2;
    sawFocus = stateDoc.hasFocus();
    return bits;
  } catch {
    return 0;
  }
}
