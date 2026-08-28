// Present host controller state to the page AS the Gamepad API.
//
// The Gamepad API does not reach WebView2 content on UWP
// (MicrosoftEdge/WebView2Feedback#4366, open since Feb 2024, no documented
// workaround). The client's input stack polls navigator.getGamepads() every
// frame, so rather than teaching the game about a console-only channel, the
// host reads Windows.Gaming.Input and this shim republishes that state through
// the exact API the game already uses. The client ships unmodified.
//
// Synthesising key events instead would have been worse: the game maps sticks
// to analogue look and move and reads button VALUES, none of which survives a
// keydown. A Gamepad object keeps the whole existing binding and remap UI
// working.
//
// Injected at document-create, before any page script, so nothing can capture
// the real (dead) getGamepads first.
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: injected as a classic script, not a module
  'use strict';
  if (!window.chrome?.webview) return;

  const BUTTONS = 16;
  const AXES = 4;

  const makeButtons = () =>
    Array.from({ length: BUTTONS }, () => ({ pressed: false, touched: false, value: 0 }));
  const makeAxes = () => Array.from({ length: AXES }, () => 0);

  // One live object reused across polls. The Gamepad API hands back a snapshot
  // each call, but callers overwhelmingly read it immediately, and reallocating
  // 16 button records every frame is pure garbage on a console.
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD)',
    index: 0,
    connected: false,
    mapping: 'standard',
    timestamp: 0,
    axes: makeAxes(),
    buttons: makeButtons(),
    vibrationActuator: null,
  };

  let announced = false;

  const fire = (type) => {
    let ev;
    try {
      ev = new GamepadEvent(type, { gamepad: pad });
    } catch {
      // GamepadEvent is not constructible everywhere; a plain Event with the
      // property attached is enough for listeners that read e.gamepad.
      ev = new Event(type);
      try {
        ev.gamepad = pad;
      } catch {
        // Frozen Event: listeners can still poll navigator.getGamepads().
      }
    }
    window.dispatchEvent(ev);
  };

  window.chrome.webview.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.t !== 'pad') return;

    if (!m.connected) {
      if (pad.connected) {
        pad.connected = false;
        // Release everything: a disconnect mid-press would otherwise latch the
        // button down forever, and the character would keep walking.
        pad.buttons = makeButtons();
        pad.axes = makeAxes();
        pad.timestamp = performance.now();
        announced = false;
        fire('gamepaddisconnected');
      }
      return;
    }

    for (let i = 0; i < BUTTONS; i++) {
      const down = !!m.buttons?.[i];
      const b = pad.buttons[i];
      b.pressed = down;
      b.touched = down;
      b.value = down ? 1 : 0;
    }
    for (let a = 0; a < AXES; a++) {
      const value = m.axes?.[a];
      pad.axes[a] = typeof value === 'number' ? value : 0;
    }
    pad.connected = true;
    // Callers use timestamp to detect "has anything changed since I last looked".
    pad.timestamp = performance.now();

    if (!announced) {
      announced = true;
      fire('gamepadconnected');
    }
  });

  const EMPTY = [null, null, null, null];
  const getGamepads = () => (pad.connected ? [pad, null, null, null] : EMPTY);

  try {
    Object.defineProperty(navigator, 'getGamepads', {
      value: getGamepads,
      configurable: true,
      writable: true,
    });
  } catch {
    navigator.getGamepads = getGamepads;
  }
  if (navigator.webkitGetGamepads) navigator.webkitGetGamepads = getGamepads;
})();
