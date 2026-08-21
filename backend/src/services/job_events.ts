/**
 * In-process pub/sub for live job updates (WebSocket `/ws/v1/jobs`).
 *
 * The db layer (db/jobs.ts, db/renders.ts) is the single choke point for all
 * job-state writes; it calls the `emit*` helpers here on every progress tick
 * and status transition. The WS route subscribes and forwards messages to
 * every connected, authenticated client. This module has no imports so the
 * db layer can depend on it without cycles.
 */

export type JobEventKind = "progress" | "status";

export interface JobEventMessage {
  kind: JobEventKind;
  /** Set for generation jobs (generation_jobs). */
  jobId?: string;
  /** Set for render jobs (render_jobs). */
  renderId?: string;
  /** 0-100, present on progress messages. */
  progress?: number;
  /** Job status name, present on status messages. */
  status?: string;
}

type Listener = (message: JobEventMessage) => void;

const listeners = new Set<Listener>();

export function subscribeJobEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(message: JobEventMessage): void {
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // A broken subscriber must not take down the job pipeline.
    }
  }
}

export function emitJobStatus(jobId: string, status: string): void {
  emit({ kind: "status", jobId, status });
}

export function emitJobProgress(jobId: string, progress: number): void {
  emit({ kind: "progress", jobId, progress });
}

export function emitRenderStatus(renderId: string, status: string): void {
  emit({ kind: "status", renderId, status });
}

export function emitRenderProgress(renderId: string, progress: number): void {
  emit({ kind: "progress", renderId, progress });
}
