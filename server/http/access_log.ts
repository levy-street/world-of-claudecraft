// The access-log MetricSink for the API request pipeline.
//
// It adapts the MetricSink seam (server/http/middleware/metric_sink.ts) to
// the structured logger: one 'access' line per recorded request, carrying the
// method, the :param ROUTE TEMPLATE (never a concrete id path, to bound log
// cardinality), the final status, the request duration, and the resolved client
// IP. The reqId is added by the logger itself from the request-scoped
// AsyncLocalStorage (withMetrics records inside the onion's runWithReqId scope), so
// it is not re-passed here.
//
// The IP is TRUNCATED at this log surface (privacy review): the last
// IPv4 octet is masked and IPv6 keeps its first three hextets, which preserves
// subnet-level abuse correlation without writing a full client IP to stdout. The
// in-memory MetricEvent keeps the full value for non-log consumers; the
// validated-config exposure gate owns any future full-IP exception.

import type { Logger } from './logger';
import type { MetricEvent, MetricSink } from './middleware/metric_sink';

/** How many leading IPv6 hextets survive truncation (roughly the /48 site prefix). */
const V6_KEPT_HEXTETS = 3;

/**
 * Truncate a client IP for the log surface. IPv4 (and the dotted tail of an
 * IPv4-mapped IPv6) masks the last octet to 'x'; IPv6 keeps the first
 * V6_KEPT_HEXTETS hextets and collapses the rest to '::'. A value that looks like
 * neither passes through untouched (it is not an IP).
 */
export function truncateIpForLog(ip: string): string {
  const lastDot = ip.lastIndexOf('.');
  if (lastDot > 0) return `${ip.slice(0, lastDot)}.x`;
  if (ip.includes(':')) {
    const kept: string[] = [];
    for (const hextet of ip.split(':')) {
      if (hextet === '' || kept.length >= V6_KEPT_HEXTETS) break;
      kept.push(hextet);
    }
    return `${kept.join(':')}::`;
  }
  return ip;
}

/** Build a MetricSink that emits one structured 'access' line per event via `log`. */
export function createAccessLogSink(log: Logger): MetricSink {
  return {
    record(event: MetricEvent): void {
      log.info(
        {
          method: event.method,
          route: event.route,
          status: event.status,
          durationMs: event.durationMs,
          ip: event.ip === undefined ? undefined : truncateIpForLog(event.ip),
        },
        'access',
      );
    },
  };
}
