import { afterEach, beforeEach, expect, test } from 'bun:test';
import { getPlaybackRate, savePlaybackRate } from '../src/lib/audio/playbackRatePreference';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  getPlaybackRate();
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('defaults to normal speed and persists the last selection', () => {
  expect(getPlaybackRate()).toBe(1);
  expect(savePlaybackRate(1.5)).toBe(1.5);
  expect(values.get('voicebox.playbackRate')).toBe('1.5');
  expect(getPlaybackRate()).toBe(1.5);
});

test('reads the persisted speed on fresh playback after another window or restart', () => {
  savePlaybackRate(1.5);
  values.set('voicebox.playbackRate', '1.75');
  expect(getPlaybackRate()).toBe(1.75);
  values.set('voicebox.playbackRate', '0.75');
  expect(getPlaybackRate()).toBe(0.75);
  values.set('voicebox.playbackRate', '2');
  expect(getPlaybackRate()).toBe(2);
});

test('invalid stored values fall back to normal speed and invalid saves preserve the choice', () => {
  for (const invalid of ['', 'oops', 'NaN', 'Infinity', '0.5', '2.5']) {
    values.set('voicebox.playbackRate', invalid);
    expect(getPlaybackRate()).toBe(1);
  }
  savePlaybackRate(1.5);
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, 2.5]) {
    expect(savePlaybackRate(invalid)).toBe(1.5);
    expect(getPlaybackRate()).toBe(1.5);
  }
});

test('storage access failure does not interrupt playback or lose this window’s choice', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage unavailable');
    },
  });
  expect(savePlaybackRate(1.5)).toBe(1.5);
  expect(getPlaybackRate()).toBe(1.5);
});
