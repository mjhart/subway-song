const SEMITONES_FROM_C: Record<string, number> = { 'A': 9, 'B': 11, 'C#': 1, 'D': 2, 'E': 4, 'F#': 6, 'G#': 8 };

export function noteFrequency(note: string): number {
  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) throw new Error(`Unknown note ${note}`);
  const midi = 12 * (Number(match[2]) + 1) + SEMITONES_FROM_C[match[1]];
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Plays sine-wave notes. Browsers only allow audio to start from a user
 * gesture, so construct this in a click handler.
 */
export class SineSynth {
  private audio = new AudioContext();
  private master = this.audio.createGain();

  constructor() {
    this.master.connect(this.audio.destination);
  }

  // Mutes rather than suspends: suspending would stop the audio clock and
  // make already-scheduled notes play late.
  setEnabled(enabled: boolean): void {
    this.master.gain.value = enabled ? 1 : 0;
  }

  /** Schedules a note (e.g. "C#4") to start delayMs from now. */
  play(note: string, durationSeconds: number, delayMs: number): void {
    const frequency = noteFrequency(note);
    const start = this.audio.currentTime + delayMs / 1000;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    // High sine tones sound much louder than low ones at equal gain.
    const peak = 0.2 * Math.min(1, Math.sqrt(440 / frequency));
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + durationSeconds);
  }

  close(): void {
    void this.audio.close();
  }
}
