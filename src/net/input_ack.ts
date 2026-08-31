export function foldInputAck(
  rawAck: unknown,
  ackedInputSeq: number,
  pendingInputSeqSentAt: Map<number, number>,
  inputEchoSamples: number[],
  now: number,
): number {
  if (typeof rawAck !== 'number' || rawAck <= ackedInputSeq) return ackedInputSeq;
  for (let seq = ackedInputSeq + 1; seq <= rawAck; seq++) {
    const sentAt = pendingInputSeqSentAt.get(seq);
    if (sentAt === undefined) continue;
    inputEchoSamples.push(now - sentAt);
    pendingInputSeqSentAt.delete(seq);
  }
  return rawAck;
}
