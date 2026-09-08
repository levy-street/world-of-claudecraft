import { expect, it, vi } from 'vitest';
import { prepareStudioForms } from '../src/render/studio_form_preparation';

it('finishes each actual form before admitting another and reuses retained rigs', async () => {
  const view: Record<string, unknown> = {};
  const built: string[] = [];
  const build = vi.fn((key: string, slot: string) => {
    expect(view.formCompilePending).toBeFalsy();
    built.push(key);
    view[slot] = {};
    view.formCompilePending = view[slot];
  });
  const pump = vi.fn();
  const next = vi.fn(async () => {
    view.formCompilePending = null;
  });
  await prepareStudioForms('druid', view, build, pump, () => true, next);
  expect(built).toEqual(['form_bear', 'form_cat', 'form_moonkin', 'form_travel']);
  expect(next).toHaveBeenCalledTimes(4);
  await prepareStudioForms('druid', view, build, pump, () => true, next);
  expect(build).toHaveBeenCalledTimes(4);
  expect(next).toHaveBeenCalledTimes(4);
});

it('abandons stale preparation without admitting another form', async () => {
  const view: Record<string, unknown> = {};
  let current = true;
  const build = vi.fn((_key: string, slot: string) => {
    view[slot] = {};
    view.formCompilePending = view[slot];
  });
  await prepareStudioForms(
    'druid',
    view,
    build,
    () => {},
    () => current,
    async () => {
      current = false;
    },
  );
  expect(build).toHaveBeenCalledTimes(1);
});

it.each([
  ['shaman', 'form_cat'],
  ['warlock', 'form_metamorph'],
])('prepares only the actual %s transformation', async (cls, key) => {
  const view: Record<string, unknown> = {};
  const build = vi.fn((_key: string, slot: string) => {
    view[slot] = {};
  });
  await prepareStudioForms(
    cls,
    view,
    build,
    () => {},
    () => true,
  );
  expect(build).toHaveBeenCalledOnce();
  expect(build.mock.calls[0][0]).toBe(key);
});
