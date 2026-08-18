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
  /**
   * Synchronous scene-active truth for the local player. Offline it reads
   * the authoritative playback registry, which is set in the SAME call that
   * mutates the world (the ferry fare teleports the rider and starts the
   * voyage synchronously from the answer click, BEFORE the next tick drains
   * the scene events); online it mirrors scene events at message receipt.
   * Frame-loop gates read this instead of the event-fed scene director so
   * they can never race the drain (the zone-warmup loading-screen
   * suppression is the consumer).
   */
  sceneActiveForLocalPlayer(): boolean;
}
