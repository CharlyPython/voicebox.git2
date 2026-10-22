import { Minus, Pause, Play, Plus, RotateCcw, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SpeechPlayerProps {
  title: string;
  status: 'generating' | 'playing' | 'paused' | 'ended';
  position: number;
  duration: number | null;
  bufferedDuration: number;
  canSeek: boolean;
  playbackRate: number;
  canChangeRate: boolean;
  onToggle: () => void;
  onSeek: (position: number) => void;
  onStop: () => void;
  onRateChange: (rate: number) => void;
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

function finiteSeconds(seconds: number) {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

function clock(seconds: number) {
  const value = Math.floor(finiteSeconds(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** Shared transport surface. The audio remains with its original playback owner. */
export function SpeechPlayer({
  title,
  status,
  position,
  duration,
  bufferedDuration,
  canSeek,
  playbackRate,
  canChangeRate,
  onToggle,
  onSeek,
  onStop,
  onRateChange,
}: SpeechPlayerProps) {
  const { t } = useTranslation();
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const hasDuration = duration !== null && Number.isFinite(duration) && duration >= 0;
  const max = finiteSeconds(hasDuration ? duration : bufferedDuration);
  const displayPosition = Math.min(finiteSeconds(scrubPosition ?? position), max);
  const isPaused = status === 'paused';
  const isEnded = status === 'ended';
  const label = t(
    isEnded ? 'speechPlayer.replay' : isPaused ? 'speechPlayer.resume' : 'speechPlayer.pause',
  );
  const rate = Number.isFinite(playbackRate) ? Math.min(2, Math.max(0.75, playbackRate)) : 1;
  const slowerRate = [...RATES].reverse().find((candidate) => candidate < rate);
  const fasterRate = RATES.find((candidate) => candidate > rate);
  const clearScrub = () => {
    draggingRef.current = false;
    pendingSeekRef.current = null;
    setScrubPosition(null);
  };
  const commitSeek = (value: number) => {
    clearScrub();
    if (canSeek && max > 0) onSeek(Math.min(finiteSeconds(value), max));
  };
  const positionText = t(
    hasDuration ? 'speechPlayer.positionValue' : 'speechPlayer.bufferedPositionValue',
    {
      position: clock(displayPosition),
      duration: clock(max),
    },
  );

  return (
    <section
      aria-label={t('speechPlayer.regionLabel')}
      className="w-full max-w-[396px] rounded-2xl bg-white/95 px-4 py-3 text-zinc-900 shadow-lg ring-1 ring-black/10 backdrop-blur-xl dark:bg-zinc-900/95 dark:text-white dark:ring-white/10"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={label}
          disabled={status === 'generating'}
          onClick={onToggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
        >
          {isEnded ? (
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          ) : isPaused ? (
            <Play aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Pause aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{title}</p>
          <p aria-live="polite" className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {t(
              status === 'generating'
                ? 'speechPlayer.preparing'
                : isEnded
                  ? 'speechPlayer.finished'
                  : isPaused
                    ? 'speechPlayer.paused'
                    : hasDuration
                      ? 'speechPlayer.playing'
                      : 'speechPlayer.generatingMore',
            )}
          </p>
        </div>
        <button
          type="button"
          aria-label={t(isEnded ? 'speechPlayer.dismiss' : 'speechPlayer.stop')}
          onClick={onStop}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
        >
          {isEnded ? (
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Square aria-hidden="true" className="h-3 w-3" />
          )}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="w-8 shrink-0 text-[10px] tabular-nums">{clock(displayPosition)}</span>
        <input
          type="range"
          aria-label={t('speechPlayer.position')}
          aria-valuetext={positionText}
          min={0}
          max={Math.max(max, 0.01)}
          step={0.1}
          disabled={!canSeek || max <= 0}
          value={displayPosition}
          className="h-4 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default disabled:opacity-40"
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (draggingRef.current) {
              pendingSeekRef.current = value;
              setScrubPosition(value);
            } else {
              // Keyboard and assistive controls seek immediately.
              commitSeek(value);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            draggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            if (draggingRef.current) commitSeek(Number(event.currentTarget.value));
          }}
          onPointerCancel={clearScrub}
          onLostPointerCapture={clearScrub}
          onBlur={() => {
            // A blur can precede pointerup. Clear the drag flag so the next
            // keyboard change still commits, and do not seek a second time.
            if (pendingSeekRef.current !== null) commitSeek(pendingSeekRef.current);
            else clearScrub();
          }}
        />
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums">
          {hasDuration ? clock(max) : `${clock(max)}+`}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-end gap-1 text-[10px]">
        {!canChangeRate && (
          <span className="mr-auto text-zinc-500 dark:text-zinc-400">
            {t('speechPlayer.speedUnavailable')}
          </span>
        )}
        <span className="mr-1 text-zinc-500 dark:text-zinc-400">{t('speechPlayer.speed')}</span>
        <button
          type="button"
          aria-label={t('speechPlayer.decreaseSpeed')}
          disabled={!canChangeRate || slowerRate === undefined}
          onClick={() => {
            if (slowerRate !== undefined) onRateChange(slowerRate);
          }}
          className="flex h-5 w-6 items-center justify-center rounded hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <Minus aria-hidden="true" className="h-3 w-3" />
        </button>
        <output
          aria-label={t('speechPlayer.playbackSpeed')}
          className="min-w-8 text-center tabular-nums"
        >
          {rate}×
        </output>
        <button
          type="button"
          aria-label={t('speechPlayer.increaseSpeed')}
          disabled={!canChangeRate || fasterRate === undefined}
          onClick={() => {
            if (fasterRate !== undefined) onRateChange(fasterRate);
          }}
          className="flex h-5 w-6 items-center justify-center rounded hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <Plus aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>
    </section>
  );
}
