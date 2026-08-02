// The parkour-course kernel: deterministic, clock-driven platforming
// mechanics generic over any consumer that can host elevated decks over a
// real floor. Rifts are the first consumer (src/sim/rift/course_gen.ts
// generates plans; runs.ts drives them); the kernel itself knows nothing
// about rifts, dungeons, or the world grid.
//
// Three files, one contract:
//   motion.ts  the course clock and every closed-form motion/phase function
//   state.ts   the registries that remember what bodies did (crumble arms,
//              checkpoints, gems, rope oscillators)
//   floor.ts   the plan types and the standing-support query
//
// The contract: sim collision and renderer animation evaluate the SAME
// functions at the SAME clock value. Zero rng anywhere. Same inputs, same
// course, every host.

export {
  type CourseBrazier,
  type CourseChase,
  type CourseCrate,
  type CourseDeck,
  type CourseDeckKind,
  type CourseGem,
  type CoursePad,
  type CoursePlan,
  type CourseStand,
  courseDeckCentre,
  courseDeckSolid,
  courseDeckTop,
  coursePadAt,
  courseSupportAt,
} from './floor';
export {
  blinkSolid,
  type CourseDuty,
  type CourseHazard,
  type CourseHazardKind,
  type CourseMotion,
  type CourseTrack,
  courseClockNow,
  dutyActive,
  dutyTimeToFlip,
  ferryPos,
  hazardActive,
  hazardPos,
  pistonLift,
  setCourseClock,
  sweeperAngle,
  sweeperFrame,
} from './motion';
export {
  armCourseChase,
  armCourseCrumble,
  type CourseCrumblePhase,
  type CourseCrumbleSpec,
  type CourseRope,
  collectCourseGem,
  courseCheckpointFor,
  courseCrumbleArmedAt,
  courseCrumblePhase,
  courseGemCount,
  courseRopeFloorAt,
  courseRopeOffset,
  courseRopePointAt,
  deferCourseCrumbleRehang,
  lightCourseCheckpoint,
  resetCourseState,
  resetCourseStateFor,
  stepCourseRopes,
} from './state';
