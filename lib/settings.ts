// The numbers that shape the music. They are quoted in the on-site
// description (components/HowItWorks.tsx), which reads them from here.

/** Length of one playback period ("bar"): a batch of arrivals is played across it. */
export const POLL_INTERVAL_MS = 15000;
// Each poll runs this long before the playback period it feeds, so the batch
// is in hand before the period starts.
export const POLL_LEAD_MS = 4000;
export const MAX_LOG_ENTRIES = 500;
export const MIN_NOTE_SECONDS = 0.2;
export const MAX_NOTE_SECONDS = 1.5;
// Most arrivals sharing a timestamp that may sound together.
export const MAX_CHORD_NOTES = 3;
/** Tempo of the grid notes are snapped to. */
export const TEMPO_BPM = 100;
// Notes start on 16th notes: four grid steps per beat.
export const GRID_STEPS_PER_BEAT = 4;
/** Length of one grid step: a 16th note at TEMPO_BPM. */
export const GRID_MS = 60000 / TEMPO_BPM / GRID_STEPS_PER_BEAT;
