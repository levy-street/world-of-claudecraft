# Realm overlays

A display-only overlay system: run multiple "realms" (themed presentations)
on top of the same base sim without forking it. Each realm supplies strings,
colors, class skins, and item-rarity flavor; none of it mutates Sim state, so
the base game can change freely and realm packs keep working.

## Files (`src/realms/`)

- `types.ts` — `RealmContent` / `RealmBranding` / `RealmClassSkin`. `RealmId`
  is a free-form string so you can register any realms.
- `registry.ts` — `createRealmRegistry(realms)` returns helpers
  (`getActiveRealm`, `resolveActiveRealmId` from `?realm=`/localStorage,
  `HOME_REALM_LIST`, cross-realm hub support, etc.).
- `rarity.ts` — item rarity tiers + affix rolling (`generateRealmItem`).
- `pickit.ts` — a pickit-style item filter (`parsePickitFilter`, `evaluateItem`).
- `example.realm.ts` — a neutral reference realm.

## Usage

```ts
import { createRealmRegistry } from './realms/registry';
import { EXAMPLE_REALM } from './realms/example.realm';

const realms = createRealmRegistry([EXAMPLE_REALM /*, ...your realms */]);
const active = realms.getActiveRealm();
// feed active.name / branding / classes into your renderer + login UI
```

Additive and standalone — nothing in the base game depends on it until you
wire `getActiveRealm()` into the UI.
