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

    const reconnectStart = mainSource.indexOf('online.onReconnected = () => {');
    const reconnectEnd = mainSource.indexOf('\n    };', reconnectStart);
    expect(reconnectStart).toBeGreaterThan(-1);
    expect(reconnectEnd).toBeGreaterThan(reconnectStart);
    const reconnectHook = mainSource.slice(reconnectStart, reconnectEnd);
    expect(reconnectHook).toContain('priorOnReconnected?.();');
    expect(reconnectHook).toContain('hud.resyncAfterReconnect();');
    expect(reconnectHook).toContain('inputEcho.echoMs = inputEcho.jitterMs = 0;');
    expect(reconnectHook).toContain('Object.assign(kbTurn, newKeyboardTurnState());');
    expect(reconnectHook).toContain('movementPrediction.reset();');
  });
});
