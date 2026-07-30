// Last Bell scenes facet: the mirrored clock scene presentation reads, plus
// the two commands it sends back to the authoritative sim. Scene state flows
// as personal SimEvents ('scene' / 'sceneChoice' / 'sceneChoiceResult').
export interface IWorldScenes {
  /**
   * Authoritative simulation seconds. Offline this is Sim.time; online it is
   * the latest mirrored server presentation time.
   */
  readonly presentationTime: number;
  /** Request a skip of the active scene. Solo skips are immediate; in a party
   *  the sim ends the scene once every living participant has asked. */
  sceneSkip(): void;
  /** Answer an active dialogue choice. Only the leader's answer counts; the
   *  sim ignores everyone else's click (leader-answer party semantics). */
  answerSceneChoice(choiceId: string, optionId: string): void;
}
