import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { type FileSpeechState, FileSpeechTransport } from '../src/lib/audio/FileSpeechTransport';

class FakeSource {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  status(status: string) {
    this.onmessage?.({ data: JSON.stringify({ status }) });
  }
}

class FakeAudio {
  private position = 0;
  get currentTime() {
    return this.position;
  }
  set currentTime(value: number) {
    this.position = value;
    this.ended = false;
  }
  duration = Number.NaN;
  readyState = 0;
  playbackRate = 1;
  preservesPitch = false;
  paused = true;
  ended = false;
  playCalls = 0;
  pauseCalls = 0;
  sourceRemoved = false;
  deferEvents = false;
  queuedEvents: Array<() => void> = [];
  private dispatch(callback: (() => void) | null) {
    if (!callback) return;
    if (this.deferEvents) this.queuedEvents.push(callback);
    else callback();
  }
  flushEvents() {
    for (const callback of this.queuedEvents.splice(0)) callback();
  }
  playResult: Promise<void> = Promise.resolve();
  onloadedmetadata: (() => void) | null = null;
  ondurationchange: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  load() {}
  removeAttribute(name: string) {
    if (name === 'src') this.sourceRemoved = true;
  }
  play() {
    this.playCalls++;
    this.paused = false;
    this.ended = false;
    return this.playResult;
  }
  pause() {
    this.pauseCalls++;
    this.paused = true;
    this.dispatch(this.onpause);
  }
  ready(duration = 120) {
    this.duration = duration;
    this.readyState = 1;
    this.onloadedmetadata?.();
  }
  playing() {
    this.paused = false;
    this.onplaying?.();
  }
  advance(position: number) {
    this.currentTime = position;
    this.ontimeupdate?.();
  }
  finish() {
    this.currentTime = this.duration;
    this.ended = true;
    this.paused = true;
    this.dispatch(this.onended);
  }
}

let sources: FakeSource[];
let audio: FakeAudio[];
let states: Array<FileSpeechState | null>;
let transport: FileSpeechTransport;
const stored = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

beforeEach(() => {
  sources = [];
  audio = [];
  states = [];
  stored.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  transport = new FileSpeechTransport({
    audioUrl: (id) => `/audio/${id}`,
    statusUrl: (id) => `/status/${id}`,
    createAudio: () => {
      const next = new FakeAudio();
      audio.push(next);
      return next as unknown as HTMLAudioElement;
    },
    createSource: () => {
      const next = new FakeSource();
      sources.push(next);
      return next as unknown as EventSource;
    },
    onChange: (state) => states.push(state),
  });
});
afterEach(() => {
  transport.stop();
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

function ready() {
  transport.start('one');
  sources[0].status('completed');
  audio[0].ready();
  audio[0].playing();
  return audio[0];
}

test('waits for completed audio and uses the media content clock at the saved speed', () => {
  stored.set('voicebox.playbackRate', '1.5');
  transport.start('one');
  expect(transport.current?.status).toBe('generating');
  expect(audio).toHaveLength(0);
  sources[0].onmessage?.({ data: 'heartbeat' });
  sources[0].status('processing');
  sources[0].status('completed');
  expect(sources[0].closed).toBe(true);
  const player = audio[0];
  expect(player.playbackRate).toBe(1.5);
  expect(player.preservesPitch).toBe(true);
  expect(player.playCalls).toBe(0);
  player.ready();
  player.playing();
  player.advance(17.25);
  expect(transport.current).toMatchObject({
    status: 'playing',
    duration: 120,
    position: 17.25,
    playbackRate: 1.5,
  });
  transport.toggle();
  expect(transport.current?.status).toBe('paused');
  expect(transport.current?.position).toBe(17.25);
  transport.toggle();
  player.playing();
  expect(transport.current?.status).toBe('playing');
  expect(player.playCalls).toBe(2);
});

test('latest speech wins and late status, media events and play rejections cannot mutate its replacement', async () => {
  transport.start('one');
  const oldStatus = sources[0].onmessage;
  sources[0].status('completed');
  const oldAudio = audio[0];
  let rejectPlay!: (reason: Error) => void;
  oldAudio.playResult = new Promise((_, reject) => {
    rejectPlay = reject;
  });
  oldAudio.ready();
  const oldEnded = oldAudio.onended;
  const oldMetadata = oldAudio.onloadedmetadata;
  const oldPlaying = oldAudio.onplaying;
  const oldError = oldAudio.onerror;
  transport.start('two');
  expect(oldAudio.sourceRemoved).toBe(true);
  expect(oldAudio.onended).toBeNull();
  expect(oldAudio.onpause).toBeNull();
  expect(oldAudio.ontimeupdate).toBeNull();
  oldStatus?.({ data: '{"status":"completed"}' });
  oldEnded?.();
  oldMetadata?.();
  oldPlaying?.();
  oldError?.();
  rejectPlay(new Error('replaced'));
  await Promise.resolve();
  expect(transport.current?.generationId).toBe('two');
  expect(audio).toHaveLength(1);
  sources[1].status('completed');
  audio[1].ready();
  audio[1].playing();
  expect(transport.current?.generationId).toBe('two');
  expect(transport.current?.status).toBe('playing');
});

test('pause while loading prevents autoplay; interrupted play promise does not dismiss paused speech', async () => {
  transport.start('one');
  sources[0].status('completed');
  const player = audio[0];
  transport.toggle();
  player.ready();
  expect(player.playCalls).toBe(0);
  expect(transport.current?.status).toBe('paused');
  let rejectPlay!: (reason: Error) => void;
  player.playResult = new Promise((_, reject) => {
    rejectPlay = reject;
  });
  transport.toggle();
  transport.toggle();
  rejectPlay(new Error('pause interrupted play'));
  await Promise.resolve();
  expect(transport.current?.status).toBe('paused');
  expect(transport.current?.generationId).toBe('one');
});

test('seek clamps the content position and finished audio can be scrubbed, resumed and replayed', () => {
  const player = ready();
  transport.seek(-20);
  expect(player.currentTime).toBe(0);
  transport.seek(70);
  expect(player.currentTime).toBe(70);
  transport.seek(Number.NaN);
  expect(player.currentTime).toBe(70);
  transport.seek(500);
  expect(player.currentTime).toBe(120);
  player.finish();
  expect(transport.current).toMatchObject({ status: 'ended', position: 120 });
  transport.seek(30);
  expect(transport.current).toMatchObject({ status: 'paused', position: 30 });
  expect(player.playCalls).toBe(1);
  player.ended = false;
  transport.toggle();
  player.playing();
  expect(transport.current).toMatchObject({ status: 'playing', position: 30 });
  transport.replay();
  expect(transport.current).toMatchObject({ status: 'playing', position: 0 });
  expect(player.currentTime).toBe(0);
  expect(player.playCalls).toBe(3);
});

test('rate changes are bounded, saved and applied without rebuilding or decoding audio', () => {
  const player = ready();
  player.advance(47);
  transport.setPlaybackRate(1.75);
  expect(player.playbackRate).toBe(1.75);
  expect(transport.current?.position).toBe(47);
  expect(stored.get('voicebox.playbackRate')).toBe('1.75');
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0.5, 2.5])
    transport.setPlaybackRate(invalid);
  expect(player.playbackRate).toBe(1.75);
  expect(audio).toHaveLength(1);
  transport.start('two');
  sources[1].status('completed');
  expect(audio[1].playbackRate).toBe(1.75);
});

test('malformed, repeated and stale notifications do not replace or stop active audio', () => {
  const player = ready();
  transport.start('one');
  expect(sources).toHaveLength(1);
  transport.generationEnded('older', 'failed');
  transport.generationEnded('one', 'completed');
  expect(transport.current?.status).toBe('playing');
  transport.generationEnded('one', 'cancelled');
  expect(transport.current).toBeNull();
  expect(player.sourceRemoved).toBe(true);
});

test('failed generation and media errors release sources, audio handlers and retained playback', () => {
  transport.start('one');
  sources[0].status('not_found');
  expect(transport.current).toBeNull();
  expect(sources[0].closed).toBe(true);
  expect(sources[0].onmessage).toBeNull();
  transport.start('two');
  sources[1].status('completed');
  audio[0].onerror?.();
  expect(transport.current).toBeNull();
  expect(audio[0].onloadedmetadata).toBeNull();
  transport.stop();
  expect(transport.current).toBeNull();
});

test('generation timeouts are cleared on replacement, completion and stop; queued stale callbacks are inert', () => {
  const pending = new Map<number, () => void>();
  let timerId = 0;
  const setTimer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    const id = ++timerId;
    pending.set(id, callback);
    return id;
  }) as typeof setTimeout);
  const clearTimer = spyOn(globalThis, 'clearTimeout').mockImplementation(((id: number) => {
    pending.delete(id);
  }) as typeof clearTimeout);
  try {
    transport.start('one');
    transport.generationEnded('one', 'completed');
    expect(pending.size).toBe(2);
    const stale = [...pending.values()];
    transport.start('two');
    expect(pending.size).toBe(1);
    for (const callback of stale) callback();
    expect(transport.current?.generationId).toBe('two');
    sources[1].status('completed');
    expect(pending.size).toBe(0);
    transport.stop();
    expect(pending.size).toBe(0);
    transport.start('three');
    const timeout = [...pending.values()][0];
    timeout();
    expect(transport.current).toBeNull();
    expect(sources[2].closed).toBe(true);
  } finally {
    transport.stop();
    setTimer.mockRestore();
    clearTimer.mockRestore();
  }
});

test('queued pause and ended events cannot overwrite a later resume or replay of the same audio', () => {
  const player = ready();
  player.deferEvents = true;
  transport.toggle();
  expect(transport.current?.status).toBe('paused');
  expect(player.queuedEvents).toHaveLength(1);
  transport.toggle();
  expect(player.paused).toBe(false);
  player.flushEvents();
  player.playing();
  expect(transport.current?.status).toBe('playing');

  player.finish();
  expect(player.queuedEvents).toHaveLength(1);
  transport.replay();
  expect(player.ended).toBe(false);
  player.flushEvents();
  player.playing();
  expect(transport.current).toMatchObject({ status: 'playing', position: 0 });
});
