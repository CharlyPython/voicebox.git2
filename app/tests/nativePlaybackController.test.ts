import { expect, test } from 'bun:test';
import { NativePlaybackController } from '../src/lib/audio/NativePlaybackController';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('stop during a native invoke stops again after the deferred start resolves', async () => {
  const started = deferred();
  const calls: string[] = [];
  const native = new NativePlaybackController(
    async () => {
      calls.push('start');
      await started.promise;
    },
    async () => {
      calls.push('stop');
    },
  );
  const result = native.start(new Uint8Array(), ['speaker']);
  await Promise.resolve();
  await Promise.resolve();
  const stopped = native.stop();
  started.resolve();
  expect(await result).toBe(false);
  await stopped;
  expect(calls).toEqual(['start', 'stop', 'stop']);
});

test('a newer native recording starts after obsolete playback has been cleaned up', async () => {
  const started = deferred();
  const calls: string[] = [];
  const native = new NativePlaybackController(
    async (_audio, devices) => {
      calls.push(`start:${devices[0]}`);
      if (devices[0] === 'old') await started.promise;
    },
    async () => {
      calls.push('stop');
    },
  );
  const old = native.start(new Uint8Array(), ['old']);
  await Promise.resolve();
  await Promise.resolve();
  native.stop();
  const next = native.start(new Uint8Array(), ['new']);
  expect(calls).toEqual(['start:old']);
  started.resolve();
  expect(await old).toBe(false);
  expect(await next).toBe(true);
  expect(calls).toEqual(['start:old', 'stop', 'stop', 'start:new']);
});

test('a newer start awaits completion of the stop invoke', async () => {
  const stopped = deferred();
  const calls: string[] = [];
  const native = new NativePlaybackController(
    async () => {
      calls.push('start');
    },
    async () => {
      calls.push('stop');
      await stopped.promise;
    },
  );
  const stop = native.stop();
  const start = native.start(new Uint8Array(), ['speaker']);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['stop']);
  stopped.resolve();
  await stop;
  expect(await start).toBe(true);
  expect(calls).toEqual(['stop', 'start']);
});

test('a failed start cleans up before the next recording can start', async () => {
  const calls: string[] = [];
  const native = new NativePlaybackController(
    async (_data, devices) => {
      calls.push(`start:${devices[0]}`);
      if (devices[0] === 'broken') throw new Error('device disconnected');
    },
    async () => {
      calls.push('stop');
    },
  );
  await expect(native.start(new Uint8Array(), ['broken'])).rejects.toThrow('device disconnected');
  expect(await native.start(new Uint8Array(), ['working'])).toBe(true);
  expect(calls).toEqual(['start:broken', 'stop', 'start:working']);
});
