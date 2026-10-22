import { getPlaybackRate, savePlaybackRate } from './playbackRatePreference';

export interface FileSpeechState {
  generationId: string;
  source: string;
  status: 'generating' | 'playing' | 'paused' | 'ended';
  position: number;
  duration: number | null;
  playbackRate: number;
}

interface TransportOptions {
  audioUrl: (id: string) => string;
  statusUrl: (id: string) => string;
  onChange: (state: FileSpeechState | null) => void;
  createAudio?: (url: string) => HTMLAudioElement;
  createSource?: (url: string) => EventSource;
}

/** Owns a single completed-file player; a new speech request replaces the old one. */
export class FileSpeechTransport {
  private state: FileSpeechState | null = null;
  private audio: HTMLAudioElement | null = null;
  private source: EventSource | null = null;
  private statusTimeout: ReturnType<typeof setTimeout> | null = null;
  private graceTimeout: ReturnType<typeof setTimeout> | null = null;
  private cycle = 0;
  private playAttempt = 0;

  constructor(private options: TransportOptions) {}

  get current(): FileSpeechState | null {
    return this.state;
  }

  private publish(patch?: Partial<FileSpeechState>) {
    if (this.state && patch) this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  private closeStatus() {
    if (this.source) {
      this.source.onmessage = null;
      this.source.onerror = null;
      this.source.close();
      this.source = null;
    }
    if (this.statusTimeout !== null) clearTimeout(this.statusTimeout);
    if (this.graceTimeout !== null) clearTimeout(this.graceTimeout);
    this.statusTimeout = null;
    this.graceTimeout = null;
  }

  stop() {
    this.cycle += 1;
    this.playAttempt += 1;
    this.closeStatus();
    if (this.audio) {
      const audio = this.audio;
      this.audio = null;
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.onpause = null;
      audio.onloadedmetadata = null;
      audio.ondurationchange = null;
      audio.ontimeupdate = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    this.state = null;
    this.publish();
  }

  start(generationId: string, source = 'mcp') {
    if (this.state?.generationId === generationId && this.state.status !== 'ended') return;
    this.stop();
    const cycle = this.cycle;
    this.state = {
      generationId,
      source,
      status: 'generating',
      position: 0,
      duration: null,
      playbackRate: getPlaybackRate(),
    };
    this.publish();
    const statusSource = (this.options.createSource ?? ((url) => new EventSource(url)))(
      this.options.statusUrl(generationId),
    );
    this.source = statusSource;
    this.statusTimeout = setTimeout(() => {
      if (this.cycle === cycle && !this.audio) this.stop();
    }, 60_000);
    statusSource.onmessage = (event) => {
      if (this.cycle !== cycle || this.source !== statusSource) return;
      try {
        const { status } = JSON.parse(event.data) as { status?: string };
        if (status === 'completed') {
          this.closeStatus();
          this.loadAudio(cycle);
        } else if (['failed', 'cancelled', 'not_found'].includes(status ?? '')) {
          this.stop();
        }
      } catch {
        // Ignore SSE heartbeats and malformed status messages.
      }
    };
    // EventSource reconnects automatically; the timeout bounds a lost generation.
    statusSource.onerror = () => {};
  }

  generationEnded(generationId: string, status?: string) {
    if (generationId !== this.state?.generationId) return;
    if (status && status !== 'completed') {
      this.stop();
    } else if (!this.audio && this.graceTimeout === null) {
      const cycle = this.cycle;
      this.graceTimeout = setTimeout(() => {
        this.graceTimeout = null;
        if (this.cycle === cycle && !this.audio) this.stop();
      }, 15_000);
    }
  }

  private loadAudio(cycle: number) {
    if (!this.state || this.cycle !== cycle || this.audio) return;
    const audio = (this.options.createAudio ?? ((url) => new Audio(url)))(
      this.options.audioUrl(this.state.generationId),
    );
    this.audio = audio;
    audio.playbackRate = this.state.playbackRate;
    audio.preservesPitch = true;
    const active = () => this.cycle === cycle && this.audio === audio && this.state !== null;
    const syncClock = () => {
      if (!active()) return;
      const duration =
        Number.isFinite(audio.duration) && audio.duration >= 0 ? audio.duration : null;
      const position = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
      this.publish({ duration, position });
    };
    audio.onloadedmetadata = () => {
      if (!active()) return;
      syncClock();
      if (this.state?.status !== 'paused') this.play();
    };
    audio.ondurationchange = syncClock;
    audio.ontimeupdate = syncClock;
    audio.onplaying = () => {
      if (!active() || audio.paused || this.state?.status === 'paused') return;
      this.publish({ status: 'playing' });
      syncClock();
    };
    audio.onpause = () => {
      // Media events are queued: a resume may have overtaken this pause.
      if (!active() || !audio.paused || audio.ended || this.state?.status === 'ended') return;
      this.playAttempt += 1;
      this.publish({ status: 'paused' });
      syncClock();
    };
    audio.onended = () => {
      // A replay/seek can overtake an already queued end event.
      if (!active() || !audio.ended) return;
      this.playAttempt += 1;
      syncClock();
      this.publish({ status: 'ended', position: this.state?.duration ?? audio.currentTime });
    };
    audio.onerror = () => {
      if (active()) this.stop();
    };
    audio.load();
  }

  private play() {
    if (!this.audio || !this.state || this.audio.readyState === 0) return;
    const audio = this.audio;
    const cycle = this.cycle;
    const attempt = ++this.playAttempt;
    void audio.play().catch((error) => {
      // Pausing, stopping or replacing audio can reject an earlier play promise.
      if (this.cycle !== cycle || this.audio !== audio || this.playAttempt !== attempt) return;
      console.warn('[dictate] audio.play failed:', error);
      this.stop();
    });
  }

  toggle() {
    if (!this.state) return;
    if (this.state.status === 'ended') {
      this.replay();
    } else if (this.state.status === 'paused') {
      this.publish({ status: this.audio?.readyState ? 'playing' : 'generating' });
      this.play();
    } else {
      this.playAttempt += 1;
      this.publish({ status: 'paused' });
      this.audio?.pause();
    }
  }

  seek(position: number) {
    if (!this.audio || !this.state || this.state.duration === null || !Number.isFinite(position))
      return;
    const target = Math.max(0, Math.min(position, this.state.duration));
    if (this.state.status === 'ended') this.publish({ status: 'paused' });
    this.audio.currentTime = target;
    this.publish({ position: target });
  }

  replay() {
    if (!this.audio || !this.state || this.state.duration === null) return;
    this.audio.currentTime = 0;
    this.publish({ status: 'playing', position: 0 });
    this.play();
  }

  setPlaybackRate(rate: number) {
    if (!this.state || !Number.isFinite(rate) || rate < 0.75 || rate > 2) return;
    const playbackRate = savePlaybackRate(rate);
    if (this.audio) this.audio.playbackRate = playbackRate;
    this.publish({ playbackRate, position: this.audio?.currentTime ?? this.state.position });
  }
}
