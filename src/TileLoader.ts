import type { Tile } from './Tile.js';
import type { TileSource } from './TileSource.js';
import { TileState } from './types.js';

/** A tile the view wants, with its priority (lower loads first) */
export interface TileRequest {
  key: string;
  level: number;
  col: number;
  row: number;
  priority: number;
  tile: Tile;
}

export interface TileLoaderOptions {
  /** Maximum number of requests in flight (default: 6) */
  concurrency?: number;
  /** Retries after network errors and HTTP 429/5xx (default: 2) */
  retries?: number;
  /** Delay before the first retry in ms, doubling for each further one (default: 250) */
  retryDelay?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
  ) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
  }
}

interface Job {
  request: TileRequest;
  controller: AbortController | null;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function isTransient(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  // fetch rejects with a TypeError on network failure
  return err instanceof TypeError;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Loads tiles through a TileSource with a priority queue.
 *
 * Each frame, the viewer passes the complete set of tiles it wants to
 * update(). Tiles no longer wanted are dropped from the queue, and their
 * requests are aborted if in flight. The rest load in priority order with
 * bounded concurrency. Network errors and HTTP 429/5xx are retried with
 * exponential backoff; on HTTP 403 the source is asked to invalidate the
 * tile's URL and the tile is retried once with a fresh URL, to recover from
 * expired URLs.
 */
export class TileLoader {
  private readonly source: TileSource;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly retryDelay: number;

  private queue: Job[] = [];
  private active = new Map<string, Job>();

  /** Called when a tile finished loading (error is null) or failed */
  onSettled: ((request: TileRequest, error: Error | null) => void) | null = null;

  constructor(source: TileSource, options: TileLoaderOptions = {}) {
    this.source = source;
    this.concurrency = options.concurrency ?? 6;
    this.retries = options.retries ?? 2;
    this.retryDelay = options.retryDelay ?? 250;
  }

  /** Number of requests in flight */
  get inFlight(): number {
    return this.active.size;
  }

  /** Number of requests waiting */
  get queued(): number {
    return this.queue.length;
  }

  /** Whether nothing is queued or in flight */
  get idle(): boolean {
    return this.queue.length === 0 && this.active.size === 0;
  }

  /**
   * Set the tiles the view wants. Tiles that are ready, failed or already
   * loading keep their state; pending ones are queued.
   */
  update(requests: TileRequest[]): void {
    const wanted = new Map(requests.map((r) => [r.key, r]));

    for (const [key, job] of this.active) {
      if (!wanted.has(key)) {
        job.controller?.abort();
      } else {
        job.request.priority = wanted.get(key)!.priority;
      }
    }
    this.queue = this.queue.filter((job) => wanted.has(job.request.key));
    const queued = new Set(this.queue.map((job) => job.request.key));
    for (const job of this.queue) job.request.priority = wanted.get(job.request.key)!.priority;

    for (const request of requests) {
      if (this.active.has(request.key) || queued.has(request.key)) continue;
      if (request.tile.getState() !== TileState.Pending) continue;
      this.queue.push({ request, controller: null });
    }
    this.queue.sort((a, b) => a.request.priority - b.request.priority);
    this.pump();
  }

  private pump(): void {
    while (this.active.size < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.controller = new AbortController();
      this.active.set(job.request.key, job);
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const { request } = job;
    const signal = job.controller!.signal;
    request.tile.setState(TileState.Loading);
    try {
      const buffer = await this.fetchWithRetry(request, signal);
      request.tile.load(buffer);
      this.finish(job, null);
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        // Cancelled: the tile may be requested again later
        request.tile.setState(TileState.Pending);
        this.finish(job, undefined);
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        request.tile.fail(error);
        this.finish(job, error);
      }
    }
  }

  private finish(job: Job, error: Error | null | undefined): void {
    if (this.active.get(job.request.key) === job) this.active.delete(job.request.key);
    if (error !== undefined) this.onSettled?.(job.request, error);
    this.pump();
  }

  private async fetchWithRetry(request: TileRequest, signal: AbortSignal): Promise<ArrayBuffer> {
    const { level, col, row } = request;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const url = await this.source.tileUrl(level, col, row);
        if (url === null) throw new Error('Tile not available');
        signal.throwIfAborted();
        const response = await fetch(url, { signal });
        if (!response.ok) throw new HttpError(response.status, response.statusText);
        return await response.arrayBuffer();
      } catch (err) {
        if (isAbort(err) || signal.aborted) throw err;
        if (
          err instanceof HttpError &&
          err.status === 403 &&
          !refreshed &&
          this.source.invalidate
        ) {
          // The URL may have expired; get a fresh one and try once more
          this.source.invalidate(level, col, row);
          refreshed = true;
          attempt--;
          continue;
        }
        if (!isTransient(err) || attempt >= this.retries) throw err;
        await sleep(this.retryDelay * 2 ** attempt, signal);
      }
    }
  }

  /** Abort everything */
  dispose(): void {
    this.queue = [];
    for (const job of this.active.values()) job.controller?.abort();
  }
}
