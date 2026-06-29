export interface IWorldTelemetry {
  reportTelemetry(kind: string, data: Record<string, number>): void;
}
