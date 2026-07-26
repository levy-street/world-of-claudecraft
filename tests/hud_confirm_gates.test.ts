// The two irreversible one-click actions gated behind Hud.confirmDialog: the
// Pale Keeper revive (applies The Keeper's Toll). The handler is exercised directly
// (the extracted named methods the tap bindings call) with a mock
// confirmDialog, mirroring tests/daily_rewards_store_behavior.test.ts: the
// pre-existing command must fire ONLY from the dialog's onOk, never from the
// bare tap, and dismissing the dialog sends nothing.

import { describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

interface ConfirmCall {
  title: string;
  body: string;
  ok: string;
  cancel: string;
  onOk: () => void;
}

interface GateHarness {
  onResurrectAtSpiritHealer: (() => void) | null;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  requestSpiritHealerResurrect(): void;
}

function harness() {
  const confirmations: ConfirmCall[] = [];
  const hud = Object.create(Hud.prototype) as unknown as GateHarness;
  hud.confirmDialog = (title, body, ok, cancel, onOk) => {
    confirmations.push({ title, body, ok, cancel, onOk });
  };
  return { hud, confirmations };
}

describe('spirit healer revive confirmation', () => {
  it('opens the confirm and revives only from OK, never from the bare tap', () => {
    const { hud, confirmations } = harness();
    const revive = vi.fn();
    hud.onResurrectAtSpiritHealer = revive;

    hud.requestSpiritHealerResurrect();

    expect(revive).not.toHaveBeenCalled();
    expect(confirmations).toHaveLength(1);
    const confirm = confirmations[0];
    expect(confirm.title).toBe("Accept the Keeper's Toll?");
    expect(confirm.body).toContain("Keeper's Toll");
    expect(confirm.body).toContain('75%');
    expect(confirm.body).toContain('no penalty');
    expect(confirm.ok).toBe('Revive Me');
    expect(confirm.cancel).toBe('Cancel');

    confirm.onOk();
    expect(revive).toHaveBeenCalledOnce();
  });

  it('sends nothing when the dialog is dismissed', () => {
    const { hud, confirmations } = harness();
    const revive = vi.fn();
    hud.onResurrectAtSpiritHealer = revive;

    hud.requestSpiritHealerResurrect();

    // cancel/Escape tear the dialog down without running onOk (see
    // Hud.confirmDialog); dismissing must leave the command unsent.
    expect(confirmations).toHaveLength(1);
    expect(revive).not.toHaveBeenCalled();
  });
});
