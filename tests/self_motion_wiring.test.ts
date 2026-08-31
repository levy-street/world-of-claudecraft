import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('online self-motion lifecycle wiring', () => {
  it('disables prediction off-transport and clears timing estimates on reconnect', () => {
    const frameWrite = mainSource.slice(
      mainSource.indexOf(': selfMotionFrameBuffer.write('),
      mainSource.indexOf('resolved.mi,', mainSource.indexOf(': selfMotionFrameBuffer.write(')),
    );
    expect(frameWrite).toContain('net.connected &&');

    const reconnectHook = mainSource.slice(
      mainSource.indexOf('online.onReconnected = () => {'),
      mainSource.indexOf('hud.marketResyncAfterReconnect();') +
        'hud.marketResyncAfterReconnect();'.length,
    );
    expect(reconnectHook).toContain('inputEcho.echoMs = inputEcho.jitterMs = 0;');
    expect(reconnectHook).toContain('Object.assign(kbTurn, newKeyboardTurnState());');
    expect(reconnectHook).toContain('movementPrediction.reset();');
  });
});
