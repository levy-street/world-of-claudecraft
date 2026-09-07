import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const wireGlueSource = readFileSync(
  new URL('../src/game/movement_wire_glue.ts', import.meta.url),
  'utf8',
);

describe('online self-motion lifecycle wiring', () => {
  it('disables prediction off-transport and clears timing estimates on reconnect', () => {
    // Off-transport nothing is sampled, so the predicted pose freezes at the
    // last acknowledged client tick instead of running away from the truth.
    // Both send arms carry the same open-socket gate.
    expect(wireGlueSource).toContain(
      'if (this.paused || !client.movementWireIsOpen()) return false;',
    );
    expect(wireGlueSource).toContain('if (!client.movementWireIsOpen()) return false;');

    // main.ts hands the pipeline the gate verdict every frame, ?nopredict
    // included, so a gated state draws the interpolated fallback instead.
    const prepare = mainSource.slice(
      mainSource.indexOf('const selfPredictionEnabled ='),
      mainSource.indexOf(
        'movementPrediction.prepare(',
        mainSource.indexOf('const selfPredictionEnabled ='),
      ) + 'movementPrediction.prepare(net, pe, selfPredictionEnabled);'.length,
    );
    expect(prepare).toContain('!SELF_MOTION_DISABLED && selfMotionPredictionEnabled(');
    expect(prepare).toContain('movementPrediction.prepare(net, pe, selfPredictionEnabled);');

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
