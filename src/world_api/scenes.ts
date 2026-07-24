// Last Bell scenes facet: the two commands the client's scene presentation
// sends back to the authoritative sim. All scene STATE flows the other way as
// personal SimEvents ('scene' / 'sceneChoice' / 'sceneChoiceResult'); this
// facet is command-only, so both worlds stay fire-and-forget here.
export interface IWorldScenes {
  /** Request a skip of the active scene. Solo skips are immediate; in a party
   *  the sim ends the scene once every living participant has asked. */
  sceneSkip(): void;
  /** Answer an active dialogue choice. Only the leader's answer counts; the
   *  sim ignores everyone else's click (leader-answer party semantics). */
  answerSceneChoice(choiceId: string, optionId: string): void;
}
