// Minimal Discord Gateway (v10) client over `ws` (already a project dep; no new
// dependency). Handles HELLO/heartbeat/ACK, IDENTIFY, RESUME on reconnect, and
// forwards DISPATCH events to a handler. The protocol opcode/payload logic lives
// in the pure ./logic module so it is unit-tested; this file is the IO shell.
import { WebSocket } from 'ws';
import { GATEWAY_OP, heartbeatIntervalMs, identifyPayload, resumePayload } from './logic';

export interface GatewayHandlers {
  onDispatch(type: string, data: Record<string, unknown>): void;
}

// Close codes we cannot resume from / must not auto-reconnect (bad token, bad
// intents, etc.) — see Discord gateway close-code docs.
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export class Gateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private resuming = false;

  constructor(
    private token: string,
    private gatewayUrl: string,
    private handlers: GatewayHandlers,
  ) {}

  connect(resume = false): void {
    this.resuming = resume && this.sessionId !== null;
    const base = this.resuming && this.resumeUrl ? this.resumeUrl : this.gatewayUrl;
    const ws = new WebSocket(`${base}/?v=10&encoding=json`);
    this.ws = ws;
    ws.on('message', (raw) => {
      try {
        this.onMessage(JSON.parse(raw.toString()));
      } catch (err) {
        console.error('[bot] gateway parse error', err);
      }
    });
    ws.on('close', (code) => this.onClose(code));
    ws.on('error', (err) => console.error('[bot] gateway socket error', err));
  }

  private onMessage(payload: Record<string, unknown>): void {
    if (typeof payload.s === 'number') this.seq = payload.s;
    switch (payload.op) {
      case GATEWAY_OP.HELLO: {
        this.startHeartbeat(heartbeatIntervalMs(payload));
        this.send(
          this.resuming && this.sessionId
            ? resumePayload(this.token, this.sessionId, this.seq)
            : identifyPayload(this.token),
        );
        break;
      }
      case GATEWAY_OP.HEARTBEAT:
        this.sendHeartbeat();
        break;
      case GATEWAY_OP.HEARTBEAT_ACK:
        this.acked = true;
        break;
      case GATEWAY_OP.INVALID_SESSION:
        // d=true means resumable; else re-identify after a short delay.
        this.resuming = payload.d === true;
        setTimeout(() => this.reconnect(this.resuming), 1500);
        break;
      case GATEWAY_OP.RECONNECT:
        this.reconnect(true);
        break;
      case GATEWAY_OP.DISPATCH: {
        const t = String(payload.t ?? '');
        const d = (payload.d ?? {}) as Record<string, unknown>;
        if (t === 'READY') {
          this.sessionId = typeof d.session_id === 'string' ? d.session_id : null;
          this.resumeUrl = typeof d.resume_gateway_url === 'string' ? d.resume_gateway_url : null;
        }
        try {
          this.handlers.onDispatch(t, d);
        } catch (err) {
          console.error('[bot] dispatch handler error', err);
        }
        break;
      }
      default:
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.acked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.acked) {
        // No ACK since the last beat: the connection is a zombie. Drop + resume.
        this.ws?.terminate();
        return;
      }
      this.sendHeartbeat();
    }, intervalMs);
  }

  private sendHeartbeat(): void {
    this.acked = false;
    this.send({ op: GATEWAY_OP.HEARTBEAT, d: this.seq });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private send(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private onClose(code: number): void {
    this.stopHeartbeat();
    if (FATAL_CLOSE_CODES.has(code)) {
      console.error(`[bot] gateway closed with fatal code ${code}; not reconnecting`);
      return;
    }
    setTimeout(() => this.reconnect(true), 2000);
  }

  private reconnect(resume: boolean): void {
    try {
      this.ws?.removeAllListeners();
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.connect(resume);
  }
}
