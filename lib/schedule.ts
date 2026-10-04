export interface PlannedChord<T> {
  /** When to play, in ms from the start of the playback period. */
  offsetMs: number;
  /** Arrivals whose notes sound together. */
  arrivals: T[];
}

// Spreads a poll's arrivals across a playback period, preserving their
// relative timing: the earliest arrival lands at the start of the period.
// The span is scaled by (n - 1) / n so the latest arrival lands one slot
// short of the end instead of on top of the next period's first note.
//
// Arrivals sharing a timestamp play together as a chord of at most
// maxChordNotes; a bigger group is split into several chords fanned out
// evenly across the gap before the next distinct timestamp.
//
// These rules are explained to site visitors in components/HowItWorks.tsx;
// update that text when they change.
export function planBatch<T extends { time: number; label: string }>(
  batch: T[],
  periodMs: number,
  maxChordNotes: number,
): PlannedChord<T>[] {
  if (!batch.length) return [];
  const groups = new Map<number, T[]>(); // timestamp -> arrivals
  for (const arrival of batch) {
    const group = groups.get(arrival.time);
    if (group) group.push(arrival);
    else groups.set(arrival.time, [arrival]);
  }
  const times = [...groups.keys()].sort((a, b) => a - b);
  const earliest = times[0];
  const span = times[times.length - 1] - earliest;
  const playSpan = periodMs * (batch.length - 1) / batch.length;
  const offsetOf = (time: number) => (span ? (time - earliest) / span * playSpan : 0);

  const plan: PlannedChord<T>[] = [];
  times.forEach((time, i) => {
    const offset = offsetOf(time);
    const nextOffset = i + 1 < times.length ? offsetOf(times[i + 1]) : periodMs;
    // Deal the group out line by line so trains on the same line, which
    // would only double the same pitch, end up in different chords.
    const group = [...groups.get(time)!].sort((a, b) => a.label.localeCompare(b.label));
    const chords = Math.ceil(group.length / maxChordNotes);
    for (let c = 0; c < chords; c++) {
      plan.push({
        offsetMs: offset + c * (nextOffset - offset) / chords,
        arrivals: group.filter((_, j) => j % chords === c),
      });
    }
  });
  return plan;
}
