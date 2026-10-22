/** Mirror the main player's transport without creating another audio source. */
export type WidgetPlaybackStatus = 'playing' | 'paused' | 'ended' | 'stopped';

export interface MainPlayerSnapshot {
  audioId: string | null;
  audioUrl: string | null;
  title: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  canSeek: boolean;
  playbackRate: number;
  canChangeRate: boolean;
}

export interface WidgetPlaybackState {
  source: 'main-player';
  sessionId: string;
  generationId: string | null;
  title: string | null;
  status: WidgetPlaybackStatus;
  currentTime: number;
  duration: number;
  canSeek: boolean;
  playbackRate: number;
  canChangeRate: boolean;
}

export interface WidgetPlaybackCommand {
  source: string;
  sessionId: string;
  command: 'play' | 'pause' | 'stop' | 'seek' | 'rate';
  time?: number;
  rate?: number;
}

interface MainPlayerControls {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  stop(): void;
  setRate(rate: number): void;
}

export class MainPlayerWidgetBridge {
  private identity: string | null = null;
  private sequence = 0;
  private sessionPrefix = `main-player-${crypto.randomUUID()}`;
  private state: WidgetPlaybackState | null = null;
  private active = false;
  private pendingPlay: string | null = null;

  constructor(
    private publish: (state: WidgetPlaybackState) => void,
    private controls: MainPlayerControls,
  ) {}

  update(snapshot: MainPlayerSnapshot): void {
    const identity = snapshot.audioUrl ? `${snapshot.audioId ?? ''}:${snapshot.audioUrl}` : null;
    if (identity !== this.identity) {
      this.clear();
      this.identity = identity;
    }
    // Loading or selecting a recording alone does not open the floating player.
    if (!snapshot.isPlaying && !this.active) return;
    if (!identity) return;
    const sessionId =
      this.active && this.state ? this.state.sessionId : `${this.sessionPrefix}-${++this.sequence}`;
    this.active = true;
    this.state = {
      source: 'main-player',
      sessionId,
      generationId: snapshot.audioId,
      title: snapshot.title,
      status: snapshot.isPlaying
        ? 'playing'
        : snapshot.duration > 0 && snapshot.currentTime >= snapshot.duration - 0.01
          ? 'ended'
          : 'paused',
      currentTime: snapshot.currentTime,
      duration: snapshot.duration,
      canSeek: snapshot.canSeek,
      playbackRate: snapshot.playbackRate,
      canChangeRate: snapshot.canChangeRate,
    };
    this.publish(this.state);
  }

  requestState(): void {
    if (this.state) this.publish(this.state);
  }

  async command(command: WidgetPlaybackCommand): Promise<void> {
    const state = this.state;
    if (
      !this.active ||
      !state ||
      command.source !== 'main-player' ||
      command.sessionId !== state.sessionId
    )
      return;
    switch (command.command) {
      case 'play':
        if (state.status === 'playing' || this.pendingPlay === state.sessionId) return;
        this.pendingPlay = state.sessionId;
        try {
          if (state.status === 'ended' && state.canSeek) this.controls.seek(0);
          await this.controls.play();
        } finally {
          if (this.pendingPlay === state.sessionId) this.pendingPlay = null;
        }
        break;
      case 'pause':
        this.controls.pause();
        break;
      case 'stop':
        this.clear();
        this.controls.stop();
        break;
      case 'rate':
        if (
          state.canChangeRate &&
          Number.isFinite(command.rate) &&
          command.rate! >= 0.75 &&
          command.rate! <= 2
        ) {
          this.controls.setRate(command.rate!);
        }
        break;
      case 'seek':
        if (state.canSeek && Number.isFinite(command.time)) {
          this.controls.seek(Math.max(0, Math.min(state.duration, command.time!)));
        }
        break;
    }
  }

  clear(): void {
    if (this.state && this.active) {
      this.state = { ...this.state, status: 'stopped' };
      this.publish(this.state);
    }
    this.active = false;
  }
}
