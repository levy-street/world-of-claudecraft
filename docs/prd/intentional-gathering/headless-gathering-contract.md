# PR3 headless gathering contract

Parent integration decision, 2026-09-07. The final parity review found that
headless had no explicit harvest binding. This supplement defines the optional gathering bridge; complete gameplay
acceptance remains pending in the draft PR. This implements the approved headless acceptance
requirement while retaining existing positional Gym actions and observations.
The previously recorded farming cut remains in effect.

## Optional protocol

The existing info reply advertises gathering: { version: 1, verbs: [...] }.
The verbs are inspect, buy_field_kit, set_preference and harvest. Exact requests:

- {cmd: 'gathering', verb: 'inspect'}
- {cmd: 'gathering', verb: 'buy_field_kit', npcId: positiveSafeInteger}
- {cmd: 'gathering', verb: 'set_preference', preference: canonicalStringToken}
- {cmd: 'gathering', verb: 'harvest', corpseId: positiveSafeInteger}

Reject arrays, non-plain records, unknown or extra keys, unsafe IDs and invalid
preference tokens. No actor override or arbitrary item grant/purchase. The item
is always field_kit and the purchase count is one. Commands before reset refuse.
No command advances sim time or episode step; existing step/noop advances casts.

Pure parsing lives in headless/gathering_protocol.ts. The module exports
GATHERING_CAPABILITY and parseGatheringRequest(raw). A sibling
headless/gathering_commands.ts exports executeGatheringCommand(simOrNull, raw),
consuming a narrow Sim-shaped host. env_server keeps only metadata and dispatch
wiring. Python mirrors exact requests through thin public methods.

## Results and discovery

Malformed and pre-reset requests return {ok:false,reason:'invalid_request'} or
{ok:false,reason:'reset_required'}. Parsed commands return ok, verb, state and
an optional stable refusal reason: purchase_refused, preference_refused, or
harvest_refused. Here ok is true only for a successful inspect, purchase,
preference application or admitted harvest start. A valid but refused action
returns ok:false with its verb, state and reason. State includes fieldKitCount,
copper and cloned preference.
A valid unchanged preference is successful. Buying succeeds only when the real
Sim.buyItem increases the kit count by one. Harvest success means the real
Sim.harvestCorpse admitted the timed start; it never means rewards landed.

Successful inspect additionally returns corpses and vendors arrays, each capped
at 16, ordered by distance then positive entity ID. Enumerate via the spatial
index before expensive inspection. Corpse rows are the existing disclosure-safe
corpseHarvestInfo answer with distance and x/z coordinates; a null answer is
never disclosed. This includes harvest-only bodies, independent of ordinary
loot, and visible denials such as missing kit or chosen material unavailable.
Vendor rows contain id, name, distance and x/z only when that NPC stocks the
kit and is within the actual purchase range. These are stock/reach facts, not
a promise that every purchase gate passes. Never duplicate vendor admission.
Inspection is read-only and has no RNG draws or queued events. No public reply
contains corpse life tokens, priority IDs or unrolled rewards.

## Acceptance evidence

Use real Sim fixtures behind the parser/dispatcher for exact request validation,
no reset, same-preference success, kit purchase/cost/refusal, missing kit,
ordinary interact loot-only, harvest-only discovery, absent preferred material,
wrong-scope/out-of-range disclosure, no-time commands, start-before-claim,
noop completion, movement cancellation and reservation release. Fixtures may
set up actors, but must not stand in for the end-to-end walkthrough.

Launch the built bundle and issue a stateful NDJSON sequence from one process:
info, pre-reset refusal, reset, malformed command, valid preference, inspection,
denied harvest, close. Pin exactly one ordered JSON line per input and unchanged
episode step across commands. Test Python requests and replies directly, ideally
against that same bundle when installed dependencies permit. Keep ACTIONS and
obsSize unchanged and preserve existing frame-skip/reward behavior.

The final gameplay walkthrough must earn and loot the 20 copper, buy from a real
seller, choose a preference explicitly, discover a body, and complete a timed
harvest via public commands. No free-kit/reset cheat or fabricated completion.
