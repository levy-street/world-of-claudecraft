import { expect, it } from 'vitest';
import {
  LAST_BELL_VOYAGE_SEGMENT_IDS,
  LB_PROP_CUE_PARK,
} from '../src/sim/content/last_bell_cinematics';
import type { SceneOpDef } from '../src/sim/scenes/registry';

type PropOpDef = Extract<SceneOpDef, { kind: 'prop' }>;
type MusicOpDef = Extract<SceneOpDef, { kind: 'music' }>;

const registeredSegment: PropOpDef['cue'] = LAST_BELL_VOYAGE_SEGMENT_IDS.out.castOff;
const parkCue: PropOpDef['cue'] = LB_PROP_CUE_PARK;
const sampledDirective: MusicOpDef['directive'] = 'lb_harbor_ambience';
const silenceDirective: MusicOpDef['directive'] = 'silence';
const resumeDirective: MusicOpDef['directive'] = 'resume';
const futureDirective: MusicOpDef['directive'] = 'theme:last_bell';

const propCueUnionIsClosed: string extends PropOpDef['cue'] ? never : true = true;
const musicDirectiveUnionIsClosed: string extends MusicOpDef['directive'] ? never : true = true;

// @ts-expect-error a misspelled prop segment id must not typecheck
const misspelledSegment: PropOpDef['cue'] = 'lb_voyage_out_cast_of';

// @ts-expect-error an unregistered music directive must not typecheck
const unregisteredDirective: MusicOpDef['directive'] = 'lb_no_such_directive';

const rawDirective: string = 'lb_harbor_ambience';
// @ts-expect-error a widened string must not satisfy the authored directive union
const widenedDirective: MusicOpDef['directive'] = rawDirective;

void propCueUnionIsClosed;
void musicDirectiveUnionIsClosed;
void misspelledSegment;
void unregisteredDirective;
void widenedDirective;

it('accepts registered authored scene references', () => {
  expect([
    registeredSegment,
    parkCue,
    sampledDirective,
    silenceDirective,
    resumeDirective,
    futureDirective,
  ]).toEqual([
    'lb_voyage_out_cast_off',
    'lb_prop_cue_park',
    'lb_harbor_ambience',
    'silence',
    'resume',
    'theme:last_bell',
  ]);
});
