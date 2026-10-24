// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placementHeightPanel } from '../src/editor/placement_height_panel';

function fixture() {
  let selected: { y: number | null } | null = { y: null };
  let step = 0.5;
  let peers: number[] = [];
  const updateSelection = vi.fn((change: { y: number }) => {
    if (selected) selected.y = change.y;
  });
  const commitSelectionTransform = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const refresh = () => {
    host.replaceChildren(
      placementHeightPanel({
        getSelection: () => selected,
        getSelectionHeights: () => peers,
        commitSelectionTransform,
        updateSelection,
        getStep: () => step,
        setStep: (value) => {
          step = value;
        },
      }),
    );
  };
  refresh();
  const click = (text: string) => {
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === text,
    );
    if (!button) throw new Error(`Missing ${text} button`);
    button.click();
  };
  return {
    host,
    refresh,
    click,
    updateSelection,
    commitSelectionTransform,
    select: (value: typeof selected) => {
      selected = value;
    },
    peers: (values: number[]) => {
      peers = values;
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('asset raise and lower panel', () => {
  it('lowers below ground, raises repeatedly from fresh values, and commits each click', () => {
    const f = fixture();
    f.click('Lower');
    expect(f.updateSelection).toHaveBeenLastCalledWith({ y: -0.5 }, true);
    f.click('Raise');
    f.refresh();
    f.click('Raise');
    expect(f.updateSelection).toHaveBeenLastCalledWith({ y: 0.5 }, true);
    expect(f.commitSelectionTransform).toHaveBeenCalledTimes(3);
    expect(f.commitSelectionTransform.mock.invocationCallOrder[0]).toBeLessThan(
      f.updateSelection.mock.invocationCallOrder[0],
    );
  });

  it('keeps the chosen step across refreshes and accepts a signed typed height', () => {
    const f = fixture();
    const select = f.host.querySelector('select')!;
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    f.click('Raise');
    f.click('Raise');
    expect(f.updateSelection).toHaveBeenLastCalledWith({ y: 10 }, true);
    expect(f.host.querySelector('select')!.value).toBe('5');
    const input = f.host.querySelector('input')!;
    input.value = '-3.25';
    input.dispatchEvent(new Event('change'));
    expect(f.updateSelection).toHaveBeenLastCalledWith({ y: -3.25 }, true);
  });

  it('does not move anything or create an undo entry beyond a member limit', () => {
    const f = fixture();
    f.peers([200]);
    f.click('Raise');
    expect(f.updateSelection).not.toHaveBeenCalled();
    f.click('Lower');
    expect(f.updateSelection).toHaveBeenLastCalledWith({ y: -0.5 }, true);
  });

  it('restores blank input and ignores a stale click after selection was cleared', () => {
    const f = fixture();
    const input = f.host.querySelector('input')!;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    expect(f.updateSelection).not.toHaveBeenCalled();
    expect(f.host.querySelector('input')!.value).toBe('0');
    f.select(null);
    f.click('Raise');
    expect(f.updateSelection).not.toHaveBeenCalled();
  });

  it('keeps the next focus target mounted when a typed edit commits before its click', () => {
    const f = fixture();
    const input = f.host.querySelector('input')!;
    const raise = [...f.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Raise',
    )!;
    input.focus();
    input.value = '-3';
    input.dispatchEvent(new Event('change'));
    expect(raise.isConnected).toBe(true);
    raise.focus();
    raise.click();
    raise.click();
    expect(document.activeElement).toBe(raise);
    expect(input.value).toBe('-2');
    expect(f.updateSelection).toHaveBeenCalledTimes(3);
  });

  it('keeps button activation keys from triggering editor shortcuts while allowing undo', () => {
    const f = fixture();
    const onKey = vi.fn();
    f.host.addEventListener('keydown', onKey);
    const button = f.host.querySelector('button')!;
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onKey).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(onKey).toHaveBeenCalledOnce();
  });
});
