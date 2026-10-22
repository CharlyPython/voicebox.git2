const STORAGE_KEY = 'voicebox.playbackRate';
let lastPlaybackRate = 1;

function isPlaybackRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 0.75 && rate <= 2;
}

/** Read for each new playback so another player window's selection is used. */
export function getPlaybackRate(): number {
  try {
    const stored = globalThis.localStorage.getItem(STORAGE_KEY);
    const rate = stored === null || stored.trim() === '' ? 1 : Number(stored);
    lastPlaybackRate = isPlaybackRate(rate) ? rate : 1;
  } catch {
    // Playback remains usable when storage is unavailable.
  }
  return lastPlaybackRate;
}

export function savePlaybackRate(rate: number): number {
  if (!isPlaybackRate(rate)) return getPlaybackRate();
  lastPlaybackRate = rate;
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // Keep the choice for this window even if it cannot be persisted.
  }
  return rate;
}
