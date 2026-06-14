# Agent-observable state contract

World of Claudecraft has one authoritative simulation model, but contributors
can observe it through several surfaces. Those surfaces are intentionally not
field-for-field identical:

- Offline play and headless tests usually inspect `Sim`/`Entity` objects from
  `src/sim/` directly.
- Online play receives compact WebSocket snapshots from `server/game.ts`.
- The browser's `ClientWorld` expands those snapshots back into objects that
  satisfy `IWorld`, with some sim fields defaulted because the server does not
  send them.
- Reinforcement-learning agents use `src/sim/obs.ts`, a normalized numeric
  vector derived from the offline sim, not the online wire format.

Use this contract when writing agents, browser checks, multiplayer scripts, or
debug docs that compare offline and live state.

## Stable online fields

After `ClientWorld.applySnapshot` has applied a server snapshot, contributors
may treat these `Entity` fields as stable for entities currently known to the
client:

| Client `Entity` field | Wire field | Notes |
| --- | --- | --- |
| `id` | `id` | Stable only for the entity's current lifetime. Respawns and reconnects can introduce new ids. |
| `kind` | `k` | Sent on first sight and when identity changes. |
| `templateId` | `tid` | Mob/NPC template id, or class for players. |
| `name` | `nm` | Sent as identity. |
| `level` | `lv` | Sent as identity. |
| `dungeonId` | `dgn` | Present for dungeon portals/objects only. |
| `scale`, `color` | `sc`, `c` | Omitted on the wire when they are default values. |
| `pos.x`, `pos.y`, `pos.z` | `x`, `y`, `z` | Rounded to two decimals by the server. |
| `facing` | `f` | Rounded to two decimals by the server. |
| `hp`, `maxHp` | `hp`, `mhp` | Authoritative health for visible entities. |
| `dead`, `lootable`, `hostile` | `dead`, `loot`, `h` | Omitted wire fields mean false. |
| `castingAbility`, `castRemaining`, `castTotal`, `channeling` | `cast`, `castRem`, `castTot`, `chan` | Casting state for visible entities. |
| `sitting` | `sit` | Also set while an entity is eating or drinking. |
| `aggroTargetId` | `aggro` | The mob or pet's current attack target id. Omitted means `null`. |
| `tappedById` | `tap` | Loot/XP/quest-credit tap owner where applicable. |
| `ownerId` | `own` | Pet owner id where applicable. |
| `threat` | `thr` | Top mob threat entries only, capped by the server. |
| `auras` | `auras` | Aura id/name/kind/timing are stable; server-only source/value details are not sent. |
| `loot` | `lootList` | Only present for lootable mob corpses with loot. |

For the local player (`world.player`), online snapshots additionally keep these
fields stable:

| Client field or store | Wire field | Notes |
| --- | --- | --- |
| `resource`, `maxResource`, `resourceType` | `res`, `mres`, `rtype` | `res` is rounded to one decimal. |
| `gcdRemaining` | `gcd` | Rounded to two decimals. |
| `comboPoints`, `comboTargetId` | `combo`, `comboTgt` | Combo state for the local player. |
| `targetId` | `target` | The local player's selected target. |
| `autoAttack`, `queuedOnSwing` | `auto`, `queued` | Local combat intent accepted by the server. |
| `attackPower`, `critChance`, `dodgeChance` | `ap`, `crit`, `dodge` | Current derived combat stats exposed to the HUD. |
| `eating`, `drinking` | `eat`, `drk` | Remaining time only; item/restoration values are not sent. |
| `inventory`, `equipment`, `questLog`, `questsDone` | `inv`, `equip`, `qlog`, `qdone` | Delta fields. If omitted after the first snapshot, keep the last value. |
| `cooldowns`, `stats`, `weapon` | `cds`, `stats`, `weapon` | Delta fields. If omitted after the first snapshot, keep the last value. |
| `partyInfo`, `tradeInfo`, `duelInfo` | `party`, `trade`, `duel` | Delta fields. If omitted after the first snapshot, keep the last value. |
| `xp`, `copper` | `xp`, `copper` | Authoritative local progression/currency counters. |

When consuming raw WebSocket snapshots, remember that identity fields can be
absent on lite records, and unchanged entities can appear only in `keep`. When
working inside the client or HUD, prefer the post-apply `ClientWorld` state
instead of interpreting raw snapshot omissions yourself.

## Offline-only and server-internal fields

These fields exist on `Entity` because the offline sim and server share the
same type, but they are not a stable online observation contract:

| Field | Why not stable online |
| --- | --- |
| `aiState` | Mob AI mode is server-side. Online `ClientWorld` defaults it to `idle`; do not use it to detect live combat. |
| `inCombat`, `combatTimer` | Server-side combat bookkeeping. Online clients should infer visible combat from events, `aggroTargetId`, and recent damage/heal events. |
| `swingTimer`, `gcdRemaining` on non-self entities | Server combat timing is not sent for arbitrary entities. |
| `cooldowns` on non-self entities | Only the local player's cooldown map is mirrored. |
| `resource`, `maxResource`, `resourceType` on non-self entities | Party frames expose party resources separately; arbitrary entity resources are not mirrored. |
| `stats`, `weapon`, `attackPower`, `rangedPower`, `critChance`, `dodgeChance` on non-self entities | Server/private combat derivation; online clients only get local derived stats. |
| `threat` entries beyond `thr` | Online snapshots send the top mob entries only. The full hate table is server/offline state. |
| `forcedTargetId`, `forcedTargetTimer` | Taunt/Growl internals. Observe the resulting `aggroTargetId` instead. |
| `spawnPos`, `wanderTarget`, `wanderTimer`, `respawnTimer`, `corpseTimer`, `xpValue` | Spawn, wander, corpse, and reward bookkeeping are server/offline state. |
| `loot` item internals before `lootList` appears | Only lootable corpses expose loot to the client. |
| `chargeTargetId`, `chargeTimeLeft`, `chargePath`, `vy`, `onGround`, `fallStartY` for non-self entities | Movement simulation details are not a general online contract. |
| Aura `sourceId`, `value`, and `school` in `ClientWorld` | Online auras are reconstructed with display/timing fields; hidden effect math remains authoritative. |

If online code currently sees a value for one of these fields, treat it as a
client default or implementation detail unless the server serializer documents
and sends it.

## Detecting aggro and threat

Use `aggroTargetId` to detect who a mob is actually attacking:

```ts
const hasAggro = mob.kind === 'mob'
  && !mob.dead
  && mob.aggroTargetId === world.playerId;
```

This is valid both offline and online after snapshots are applied. On the raw
wire, the same field is named `aggro`.

Use `threat` to show or compare the visible hate table, but keep the online
limit in mind:

```ts
const myThreat = mob.threat.get(world.playerId) ?? 0;
const targetId = mob.aggroTargetId;
```

Offline/server state has the full `Map<number, number>`. Online state has the
top entries serialized by `thr`, currently capped at eight entries and only
sent for live mobs with non-empty threat. A player can be the current
`aggroTargetId` even when an online threat map is empty or incomplete because
the entity is out of interest, dead, reset, a pet with an attack target, or the
player is beyond the top-entry cap.

For encounter detection, use a combination of:

- visible hostile mobs with `aggroTargetId !== null`;
- `aggroTargetId === world.playerId` or a party member id for party combat;
- recent routed combat events (`damage`, `heal2`, `aura`, `spellfx`) when the
  mob has just left interest or the encounter is ending.

Avoid using online `aiState === 'chase'` or `aiState === 'attack'`; those are
offline/source-sim states and are not mirrored by live snapshots.

## Observation vector

`encodeObs(sim)` in `src/sim/obs.ts` is an offline/headless agent surface. Its
combat bits are already derived from stable sim state:

- self combat uses `p.inCombat`;
- target aggro uses `target.aggroTargetId === p.id`;
- nearest-mob aggro uses `e.aggroTargetId === p.id`;
- target hostility, lootability, health, distance, and facing are normalized
  into fixed numeric slots.

Do not compare the vector slots directly to raw WebSocket fields. For online
automation, first consume the snapshot into `ClientWorld`, then derive the same
concepts from the stable fields listed above.

## Source anchors

- Server wire contract: `identityFields`, `dynamicFields`, `wireEntity`, and
  `selfWireJson` in `server/game.ts`.
- Online expansion: `ClientWorld.applySnapshot` in `src/net/online.ts`.
- Shared entity shape: `Entity` in `src/sim/types.ts`.
- Offline/headless observation vector: `encodeObs` in `src/sim/obs.ts`.
- Threat rules and top-entry serialization helper: `src/sim/threat.ts`.
