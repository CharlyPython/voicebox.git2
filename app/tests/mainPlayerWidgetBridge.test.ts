import { expect, test } from 'bun:test';
import {
  type MainPlayerSnapshot,
  MainPlayerWidgetBridge,
  type WidgetPlaybackState,
} from '../src/lib/audio/MainPlayerWidgetBridge';

function setup() {
  const states: WidgetPlaybackState[] = [];
  const calls: Array<string | number> = [];
  const bridge = new MainPlayerWidgetBridge((state) => states.push(state), {
    async play() {
      calls.push('play');
    },
    pause() {
      calls.push('pause');
    },
    seek(time) {
      calls.push(time);
    },
    stop() {
      calls.push('stop');
    },
    setRate(rate) {
      calls.push(`rate:${rate}`);
    },
  });
  const snapshot: MainPlayerSnapshot = {
    audioId: 'history-1',
    audioUrl: '/recording.wav',
    title: 'Saved speech',
    isPlaying: false,
    currentTime: 0,
    duration: 30,
    canSeek: true,
    playbackRate: 1,
    canChangeRate: true,
  };
  return { bridge, states, calls, snapshot };
}

test('only actual playback opens the widget; pause, progress and remount state remain mirrored', () => {
  const { bridge, states, snapshot } = setup();
  bridge.update(snapshot);
  expect(states).toHaveLength(0);
  bridge.update({ ...snapshot, isPlaying: true, currentTime: 4 });
  bridge.update({ ...snapshot, currentTime: 7 });
  bridge.requestState();
  expect(states.map((s) => s.status)).toEqual(['playing', 'paused', 'paused']);
  expect(states[2].currentTime).toBe(7);
  expect(states[2].title).toBe('Saved speech');
  expect(states[0].sessionId).toBe(states[2].sessionId);
});

test('widget seek and pause control the existing transport and reject stale sessions', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true });
  const command = { source: 'main-player', sessionId: states[0].sessionId };
  await bridge.command({ ...command, command: 'seek', time: 12.5 });
  await bridge.command({ ...command, command: 'pause' });
  await bridge.command({ ...command, command: 'seek', time: 50 });
  await bridge.command({ ...command, command: 'seek', time: Number.NaN });
  bridge.update({ ...snapshot, audioId: 'history-2', audioUrl: '/other.wav', isPlaying: true });
  await bridge.command({ ...command, command: 'stop' });
  expect(calls).toEqual([12.5, 'pause', 30]);
  expect(states[1].status).toBe('stopped');
  expect(states[2].sessionId).not.toBe(command.sessionId);
});

test('ended recordings replay from zero; stop dismisses until actual playback begins again', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true });
  bridge.update({ ...snapshot, currentTime: 30 });
  const command = { source: 'main-player', sessionId: states[0].sessionId };
  await bridge.command({ ...command, command: 'play' });
  expect(calls).toEqual([0, 'play']);
  await bridge.command({ ...command, command: 'stop' });
  bridge.update(snapshot);
  expect(states.at(-1)?.status).toBe('stopped');
  expect(states).toHaveLength(3);
});

test('unsupported native seek does not move only the silent visualization', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true, canSeek: false });
  await bridge.command({
    source: 'main-player',
    sessionId: states[0].sessionId,
    command: 'seek',
    time: 10,
  });
  expect(calls).toEqual([]);
});

test('speed commands retain playback and scope rate changes to the current supported session', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true, currentTime: 8 });
  const command = {
    source: 'main-player',
    sessionId: states[0].sessionId,
    command: 'rate' as const,
  };
  await bridge.command({ ...command, rate: 1.5 });
  expect(calls).toEqual(['rate:1.5']);
  bridge.update({ ...snapshot, currentTime: 8, playbackRate: 1.5 });
  expect(states.at(-1)?.playbackRate).toBe(1.5);
  expect(states.at(-1)?.status).toBe('paused');
  for (const rate of [Number.NaN, 0.25, 3]) await bridge.command({ ...command, rate });
  await bridge.command({ ...command, sessionId: 'old-session', rate: 2 });
  bridge.update({ ...snapshot, canChangeRate: false });
  await bridge.command({ ...command, rate: 2 });
  expect(calls).toEqual(['rate:1.5']);
});

test('clearing a recording invalidates commands and publishes its stopped state', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true });
  const sessionId = states[0].sessionId;
  bridge.update({ ...snapshot, audioId: null, audioUrl: null });
  await bridge.command({ source: 'main-player', sessionId, command: 'play' });
  await bridge.command({ source: 'main-player', sessionId, command: 'rate', rate: 1.5 });
  bridge.requestState();
  expect(calls).toEqual([]);
  expect(states.at(-1)?.status).toBe('stopped');
});

test('native ended replay never seeks the silent visualization', async () => {
  const { bridge, states, calls, snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true, canSeek: false, canChangeRate: false });
  bridge.update({ ...snapshot, currentTime: 30, canSeek: false, canChangeRate: false });
  await bridge.command({ source: 'main-player', sessionId: states[0].sessionId, command: 'play' });
  expect(calls).toEqual(['play']);
});

test('repeated play commands do not toggle or start duplicate asynchronous playback', async () => {
  const states: WidgetPlaybackState[] = [];
  let finishPlay!: () => void;
  let playCalls = 0;
  const pending = new Promise<void>((resolve) => {
    finishPlay = resolve;
  });
  const bridge = new MainPlayerWidgetBridge((state) => states.push(state), {
    play: async () => {
      playCalls += 1;
      await pending;
    },
    pause: () => {},
    seek: () => {},
    stop: () => {},
    setRate: () => {},
  });
  const { snapshot } = setup();
  bridge.update({ ...snapshot, isPlaying: true });
  bridge.update(snapshot);
  const command = {
    source: 'main-player',
    sessionId: states[0].sessionId,
    command: 'play' as const,
  };
  const first = bridge.command(command);
  await bridge.command(command);
  expect(playCalls).toBe(1);
  finishPlay();
  await first;
});
