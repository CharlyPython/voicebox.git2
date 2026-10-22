/** Serialize native starts and stops so an obsolete invoke cannot leave audio playing. */
export class NativePlaybackController {
  private revision = 0;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private play: (audioData: Uint8Array, deviceIds: string[]) => Promise<void>,
    private stopPlayback: () => Promise<void>,
  ) {}

  start(audioData: Uint8Array, deviceIds: string[]): Promise<boolean> {
    const revision = ++this.revision;
    const operation = this.tail
      .catch(() => {})
      .then(async () => {
        if (revision !== this.revision) return false;
        try {
          await this.play(audioData, deviceIds);
        } catch (error) {
          await this.stopPlayback();
          throw error;
        }
        if (revision !== this.revision) {
          // Complete cleanup before allowing any newer start out of the queue.
          await this.stopPlayback();
          return false;
        }
        return true;
      });
    this.tail = operation;
    return operation;
  }

  stop(): Promise<void> {
    this.revision += 1;
    const operation = this.tail.catch(() => {}).then(() => this.stopPlayback());
    this.tail = operation;
    return operation;
  }
}
