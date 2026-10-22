import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CapturePill } from '@/components/CapturePill/CapturePill';
import { apiClient } from '@/lib/api/client';
import type { FocusSnapshot } from '@/lib/api/types';
import { type FileSpeechState, FileSpeechTransport } from '@/lib/audio/FileSpeechTransport';
import { useCaptureRecordingSession } from '@/lib/hooks/useCaptureRecordingSession';
import { SpeechPlayer } from './SpeechPlayer';

interface MainPlayerState {
  source: 'main-player';
  sessionId: string;
  title?: string;
  status: 'playing' | 'paused' | 'stopped' | 'ended';
  currentTime: number;
  duration: number;
  canSeek?: boolean;
  playbackRate?: number;
  canChangeRate?: boolean;
}

/** Keep the finished recording available for replay without leaving its overlay visible. */
function useFinishedPlayerHidden(id: string | undefined, ended: boolean) {
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !ended) {
      setHiddenId(null);
      return;
    }
    const timer = window.setTimeout(() => setHiddenId(id), 5_000);
    return () => window.clearTimeout(timer);
  }, [id, ended]);
  return ended && hiddenId === id;
}

/** Floating capture and speech controls; audio stays with its original playback owner. */
export function DictateWindow() {
  const { t } = useTranslation();
  // Force the host document chrome to be transparent so the Tauri window
  // takes on the pill's own shape.
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  // Snapshot of the focused UI element at chord-start, shipped over from
  // Rust on the ``dictate:start`` payload. Held in a ref so it survives
  // the 1–2 s transcribe + refine window — the paste only fires once the
  // final text comes back.
  const focusRef = useRef<FocusSnapshot | null>(null);

  const session = useCaptureRecordingSession({
    onFinalText: async (text, _capture, allowAutoPaste) => {
      const focus = focusRef.current;
      // Consume-once: a second chord before this fires would overwrite
      // focusRef, but nulling it here guards against the late-arriving
      // refine-result firing a paste after the user has moved on.
      focusRef.current = null;
      if (!allowAutoPaste) return;
      if (!focus || !text.trim()) return;
      try {
        await invoke('paste_final_text', { text, focus });
      } catch (err) {
        // Surface accessibility failures to the main window so it can prompt
        // the user to grant permission. Other errors stay swallowed —
        // the transcription still landed in the captures list.
        const msg = err instanceof Error ? err.message : String(err);
        if (/accessibility/i.test(msg)) {
          emit('system:accessibility-missing').catch(() => {});
        }
        console.warn('[dictate] paste_final_text failed:', err);
      }
    },
  });

  // Route the chord events emitted from Rust into the session hook. Using a
  // ref so the `listen` effect only subscribes once — rebinding every render
  // would thrash the Tauri event bridge.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const unlistens: Promise<UnlistenFn>[] = [];
    unlistens.push(
      listen<{ focus: FocusSnapshot | null }>('dictate:start', (event) => {
        focusRef.current = event.payload?.focus ?? null;
        sessionRef.current.startRecording();
      }),
    );
    unlistens.push(
      listen('dictate:stop', () => {
        if (sessionRef.current.isRecording) sessionRef.current.stopRecording();
      }),
    );
    return () => {
      for (const p of unlistens) p.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // Agent speech uses the existing generation-status and completed-audio endpoints.
  const [speaking, setSpeaking] = useState<FileSpeechState | null>(null);
  const transportRef = useRef<FileSpeechTransport | null>(null);
  const [remoteSpeech, setRemoteSpeech] = useState<MainPlayerState | null>(null);

  useEffect(() => {
    let disposed = false;
    const publish = (state: FileSpeechState | null) => {
      if (disposed) return;
      setSpeaking(state);
      void emit('dictate:speech-state', {
        generationId: state?.generationId ?? null,
        source: state?.source ?? null,
        status: state?.status ?? 'idle',
        paused: state?.status === 'paused',
        position: state?.position ?? 0,
        duration: state?.duration ?? null,
        playbackRate: state?.playbackRate ?? 1,
        canReplay: state?.duration !== null && Boolean(state),
        canSeek: state?.duration !== null && Boolean(state),
        canChangeRate: Boolean(state),
        bufferedDuration: state?.duration ?? 0,
      }).catch(() => {});
    };
    const transport = new FileSpeechTransport({
      audioUrl: (id) => apiClient.getAudioUrl(id),
      statusUrl: (id) => apiClient.getGenerationStatusUrl(id),
      onChange: publish,
    });
    transportRef.current = transport;
    const unlistens: Promise<UnlistenFn>[] = [];
    function subscribe<T>(name: string, callback: (payload: T) => void) {
      unlistens.push(
        listen<T>(name, (event) => {
          if (!disposed) callback(event.payload);
        }),
      );
    }
    subscribe<string>('dictate:speak-start', (payload) => {
      try {
        const { generation_id, source } = JSON.parse(payload) as {
          generation_id?: string;
          source?: string;
        };
        if (!generation_id) return;
        setRemoteSpeech((previous) => (previous?.status === 'ended' ? null : previous));
        transport.start(generation_id, source);
      } catch {
        // Ignore malformed speak notifications.
      }
    });
    subscribe<string>('dictate:speak-end', (payload) => {
      try {
        const { generation_id, status } = JSON.parse(payload) as {
          generation_id?: string;
          status?: string;
        };
        if (generation_id) transport.generationEnded(generation_id, status);
      } catch {
        // Ignore malformed speak notifications.
      }
    });
    subscribe('dictate:request-speech-state', () => publish(transport.current));
    subscribe('dictate:toggle-speech', () => transport.toggle());
    subscribe('dictate:replay-speech', () => transport.replay());
    subscribe('dictate:stop-speech', () => transport.stop());
    subscribe<{ generationId: string; position: number }>('dictate:seek-speech', (payload) => {
      if (payload?.generationId === transport.current?.generationId)
        transport.seek(payload.position);
    });
    subscribe<{ generationId?: string; rate: number }>('dictate:speech-rate', (payload) => {
      if (
        payload &&
        (!payload.generationId || payload.generationId === transport.current?.generationId)
      ) {
        transport.setPlaybackRate(payload.rate);
      }
    });
    const mainState = listen<MainPlayerState>('voicebox-playback-state', (event) => {
      if (disposed || event.payload.source !== 'main-player') return;
      setRemoteSpeech(event.payload.status === 'stopped' ? null : event.payload);
    });
    unlistens.push(mainState);
    void mainState
      .then(() => {
        if (!disposed) void emit('voicebox-playback-request-state').catch(() => {});
      })
      .catch(() => {});
    return () => {
      disposed = true;
      transport.stop();
      transportRef.current = null;
      for (const promise of unlistens) void promise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  const localHidden = useFinishedPlayerHidden(speaking?.generationId, speaking?.status === 'ended');
  const remoteHidden = useFinishedPlayerHidden(
    remoteSpeech?.sessionId,
    remoteSpeech?.status === 'ended',
  );
  const localVisible = Boolean(
    speaking &&
      !localHidden &&
      (speaking.status === 'playing' ||
        speaking.status === 'ended' ||
        (speaking.status === 'paused' && speaking.duration !== null)),
  );
  const showRemote = Boolean(
    remoteSpeech && !remoteHidden && (!localVisible || speaking?.status === 'ended'),
  );
  const playerVisible = localVisible || showRemote;
  const captureVisible = session.pillState !== 'hidden';

  // Rust owns hiding/parking the transparent always-on-top window.
  useEffect(() => {
    void emit(playerVisible || captureVisible ? 'dictate:show' : 'dictate:hide').catch(() => {});
  }, [playerVisible, captureVisible]);

  const remoteCommand = (command: string, extra?: { rate?: number; time?: number }) => {
    if (!remoteSpeech) return;
    void emit('voicebox-playback-command', {
      source: 'main-player',
      sessionId: remoteSpeech.sessionId,
      command,
      ...extra,
    }).catch(() => {});
  };

  return (
    <div
      className="h-screen w-screen flex items-center justify-center px-3"
      style={{ background: 'transparent' }}
    >
      {session.pillState !== 'hidden' ? (
        <CapturePill
          state={session.pillState}
          elapsedMs={session.pillElapsedMs}
          errorMessage={session.errorMessage}
          onDismiss={session.dismissError}
          onStop={session.isRecording ? session.stopRecording : undefined}
        />
      ) : showRemote && remoteSpeech ? (
        <SpeechPlayer
          key={remoteSpeech.sessionId}
          title={remoteSpeech.title || t('speechPlayer.title')}
          status={remoteSpeech.status === 'stopped' ? 'ended' : remoteSpeech.status}
          position={remoteSpeech.currentTime}
          duration={remoteSpeech.duration}
          bufferedDuration={remoteSpeech.duration}
          canSeek={remoteSpeech.canSeek !== false}
          playbackRate={remoteSpeech.playbackRate ?? 1}
          canChangeRate={remoteSpeech.canChangeRate === true}
          onRateChange={(rate) => remoteCommand('rate', { rate })}
          onToggle={() => remoteCommand(remoteSpeech.status === 'playing' ? 'pause' : 'play')}
          onSeek={(time) => remoteCommand('seek', { time })}
          onStop={() => remoteCommand('stop')}
        />
      ) : localVisible && speaking ? (
        <SpeechPlayer
          key={speaking.generationId}
          title={t('speechPlayer.title')}
          status={speaking.status}
          position={speaking.position}
          duration={speaking.duration}
          bufferedDuration={speaking.duration ?? 0}
          canSeek={speaking.duration !== null}
          playbackRate={speaking.playbackRate}
          canChangeRate={true}
          onRateChange={(rate) => transportRef.current?.setPlaybackRate(rate)}
          onToggle={() => transportRef.current?.toggle()}
          onSeek={(position) => transportRef.current?.seek(position)}
          onStop={() => transportRef.current?.stop()}
        />
      ) : null}
    </div>
  );
}
