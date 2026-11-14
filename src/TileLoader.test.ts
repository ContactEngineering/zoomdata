import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tile } from './Tile.js';
import { TileLoader, type TileRequest } from './TileLoader.js';
import type { TileSource } from './TileSource.js';
import { TileState } from './types.js';

const b = readFileSync(resolve(__dirname, '../test/fixtures/decoder/offset64.nc'));
const TILE = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** A fetch whose responses the test controls, one call at a time */
interface PendingFetch {
  url: string;
  signal: AbortSignal;
  respond(status?: number): void;
  networkError(): void;
}

let calls: PendingFetch[];

function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init.signal!;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    calls.push({
      url,
      signal,
      respond: (status = 200) =>
        resolve({
          ok: status === 200,
          status,
          statusText: String(status),
          arrayBuffer: () => Promise.resolve(TILE),
        } as Response),
      networkError: () => reject(new TypeError('Failed to fetch')),
    });
  });
}

function source(): TileSource & { version: Map<string, number> } {
  const version = new Map<string, number>();
  return {
    version,
    descriptor: () => Promise.reject(new Error('unused')),
    tileUrl: async (level, col, row) => {
      const key = `${level}/${col}_${row}`;
      return `${key}?v=${version.get(key) ?? 0}`;
    },
    invalidate: vi.fn((level, col, row) => {
      const key = `${level}/${col}_${row}`;
      version.set(key, (version.get(key) ?? 0) + 1);
    }),
  };
}

function req(level: number, col: number, row: number, priority = 0): TileRequest {
  return { key: `${level}/${col}_${row}`, level, col, row, priority, tile: new Tile() };
}

/** Let promise chains run */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TileLoader', () => {
  it('bounds concurrency and loads in priority order', async () => {
    const loader = new TileLoader(source(), { concurrency: 2 });
    const settled: string[] = [];
    loader.onSettled = (r) => settled.push(r.key);
    const requests = [req(8, 0, 0, 30), req(8, 1, 0, 10), req(8, 2, 0, 20), req(5, 0, 0, -1)];
    loader.update(requests);
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['5/0_0?v=0', '8/1_0?v=0']);
    expect([loader.inFlight, loader.queued]).toEqual([2, 2]);

    calls[1].respond();
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['5/0_0?v=0', '8/1_0?v=0', '8/2_0?v=0']);
    expect(settled).toEqual(['8/1_0']);
    expect(requests[1].tile.isReady()).toBe(true);

    calls[0].respond();
    calls[2].respond();
    await flush();
    calls[3].respond();
    await flush();
    expect(loader.idle).toBe(true);
    expect(requests.every((r) => r.tile.isReady())).toBe(true);
  });

  it('re-prioritises queued tiles on update', async () => {
    const loader = new TileLoader(source(), { concurrency: 1 });
    const [a, b2, c] = [req(8, 0, 0, 0), req(8, 1, 0, 1), req(8, 2, 0, 2)];
    loader.update([a, b2, c]);
    await flush();
    loader.update([a, { ...b2, priority: 5 }, { ...c, priority: 1 }]);
    calls[0].respond();
    await flush();
    expect(calls[1].url).toBe('8/2_0?v=0');
  });

  it('does not request tiles that are ready, loading or failed', async () => {
    const loader = new TileLoader(source());
    const r = req(8, 0, 0);
    loader.update([r]);
    loader.update([r]);
    await flush();
    expect(calls).toHaveLength(1);
    calls[0].respond();
    await flush();
    loader.update([r]);
    await flush();
    expect(calls).toHaveLength(1);
  });

  it('cancels tiles that are no longer wanted', async () => {
    const loader = new TileLoader(source(), { concurrency: 1 });
    const settled = vi.fn();
    loader.onSettled = settled;
    const [a, b2] = [req(8, 0, 0, 0), req(8, 1, 0, 1)];
    loader.update([a, b2]);
    await flush();
    expect(calls).toHaveLength(1);

    // a leaves the viewport while in flight, b2 while queued
    loader.update([req(8, 2, 0)]);
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(a.tile.getState()).toBe(TileState.Pending);
    expect(b2.tile.getState()).toBe(TileState.Pending);
    expect(calls.map((c) => c.url)).toEqual(['8/0_0?v=0', '8/2_0?v=0']);
    expect(settled).not.toHaveBeenCalled();
  });

  it('retries network errors and 5xx with backoff', async () => {
    const loader = new TileLoader(source(), { retries: 2, retryDelay: 100 });
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    calls[0].networkError();
    await flush();
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toHaveLength(2);
    calls[1].respond(503);
    await flush();
    await vi.advanceTimersByTimeAsync(199);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    calls[2].respond();
    await flush();
    expect(r.tile.isReady()).toBe(true);
  });

  it('gives up after the last retry', async () => {
    const loader = new TileLoader(source(), { retries: 1, retryDelay: 100 });
    const settled = vi.fn();
    loader.onSettled = settled;
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    calls[0].respond(500);
    await vi.advanceTimersByTimeAsync(100);
    calls[1].respond(500);
    await flush();
    expect(r.tile.getState()).toBe(TileState.Error);
    expect(settled).toHaveBeenCalledWith(r, expect.objectContaining({ status: 500 }));
    expect(loader.idle).toBe(true);
  });

  it('does not retry other client errors', async () => {
    const loader = new TileLoader(source());
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    calls[0].respond(404);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
    expect(r.tile.getError()?.message).toBe('HTTP 404: 404');
  });

  it('on 403 invalidates the URL and retries once with a fresh one', async () => {
    const s = source();
    const loader = new TileLoader(s);
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    calls[0].respond(403);
    await flush();
    expect(s.invalidate).toHaveBeenCalledWith(8, 0, 0);
    expect(calls[1].url).toBe('8/0_0?v=1');
    calls[1].respond(403);
    await flush();
    expect(calls).toHaveLength(2);
    expect(r.tile.getState()).toBe(TileState.Error);
  });

  it('aborts a retry wait when cancelled', async () => {
    const loader = new TileLoader(source(), { retryDelay: 100 });
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    calls[0].networkError();
    await flush();
    loader.update([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(r.tile.getState()).toBe(TileState.Pending);
    expect(loader.idle).toBe(true);
  });

  it('marks undecodable tiles as failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
    const loader = new TileLoader(source());
    const r = req(8, 0, 0);
    loader.update([r]);
    await flush();
    expect(r.tile.getState()).toBe(TileState.Error);
  });
});
