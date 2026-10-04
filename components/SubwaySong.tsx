'use client';

import { useEffect, useRef, useState } from 'react';
import { planBatch } from '@/lib/schedule';
import { bulletLabel, DARK_TEXT_ROUTES, ROUTE_COLORS, ROUTE_NOTES, stationName } from '@/lib/subway';
import { SineSynth } from '@/lib/synth';
import { ArrivalTracker, type PollResult } from '@/lib/tracker';

const POLL_INTERVAL_MS = 15000;
// Each poll runs this long before the playback period it feeds, so the batch
// is in hand before the period starts.
const POLL_LEAD_MS = 4000;
const MAX_LOG_ENTRIES = 500;
const MIN_NOTE_SECONDS = 0.2;
const MAX_NOTE_SECONDS = 1.5;
// Most arrivals sharing a timestamp that may sound together.
const MAX_CHORD_NOTES = 3;

interface PendingArrival {
  label: string;
  station: string;
  dest?: string;
  /** Unix seconds, as reported by or inferred from the feed. */
  time: number;
}

interface PlayedArrival extends PendingArrival {
  id: number;
  note?: string;
  duration: number;
}

/** Arrivals whose notes sounded together. */
interface LogEntry {
  id: number;
  playedAt: number;
  arrivals: PlayedArrival[];
}

const formatArrived = (time: number) => new Date(time * 1000).toLocaleTimeString();
const formatPlayed = (playedAt: number) => new Date(playedAt).toLocaleTimeString([], {
  hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1,
});
const formatSound = ({ note, duration }: PlayedArrival) =>
  (note ? `${note} for ${duration.toFixed(1)}s` : 'no note');

export default function SubwaySong() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [arrivalCount, setArrivalCount] = useState(0);
  const [poll, setPoll] = useState<PollResult | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const synthRef = useRef<SineSynth | null>(null);

  useEffect(() => {
    let cancelled = false;
    let nextId = 0;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    let batch: PendingArrival[] = [];
    const tracker = new ArrivalTracker(({ routeId, stopId, destination, time }) => {
      const station = stationName(stopId);
      // The feeds include internal timing points that aren't passenger stations.
      if (!station) return;
      batch.push({ label: bulletLabel(routeId || '?'), station, dest: stationName(destination), time });
    });

    const showChord = (arrivals: PlayedArrival[]) => {
      const entry: LogEntry = { id: nextId++, playedAt: Date.now(), arrivals };
      for (const a of arrivals) {
        console.log(`${a.label} train arrived at ${a.station}${a.dest ? ` (to ${a.dest})` : ''}: `
          + `arrived ${formatArrived(a.time)}, played ${formatPlayed(entry.playedAt)}, ${formatSound(a)}`);
      }
      setEntries((prev) => {
        // Keep the log newest-first by play time; timers can fire slightly
        // out of order.
        const at = prev.findIndex((e) => e.playedAt <= entry.playedAt);
        const next = at === -1 ? [...prev, entry] : [...prev.slice(0, at), entry, ...prev.slice(at)];
        return next.slice(0, MAX_LOG_ENTRIES);
      });
      setArrivalCount((count) => count + arrivals.length);
    };

    // Playback periods run back to back from firstPeriodStart; the poll
    // feeding each one fires POLL_LEAD_MS before it begins.
    const firstPeriodStart = performance.now() + POLL_LEAD_MS;
    let period = 0;

    const tick = async () => {
      const periodStart = firstPeriodStart + period * POLL_INTERVAL_MS;
      period++;
      later(tick, periodStart + POLL_INTERVAL_MS - POLL_LEAD_MS - performance.now());

      batch = [];
      const result = await tracker.pollAll();
      if (cancelled) return;

      for (const chord of planBatch(batch, POLL_INTERVAL_MS, MAX_CHORD_NOTES)) {
        const delayMs = Math.max(0, periodStart + chord.offsetMs - performance.now());
        const played = chord.arrivals.map((arrival): PlayedArrival => ({
          ...arrival,
          id: nextId++,
          note: ROUTE_NOTES[arrival.label],
          duration: MIN_NOTE_SECONDS + Math.random() * (MAX_NOTE_SECONDS - MIN_NOTE_SECONDS),
        }));
        // The notes go on the audio clock for precise timing; the log rows
        // appear alongside them.
        for (const { note, duration } of played) {
          if (note) synthRef.current?.play(note, duration, delayMs);
        }
        later(() => showChord(played), delayMs);
      }
      setPoll(result);
    };
    tick();

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  useEffect(() => () => {
    synthRef.current?.close();
    synthRef.current = null;
  }, []);

  const toggleSound = () => {
    synthRef.current ??= new SineSynth();
    synthRef.current.setEnabled(!soundOn);
    setSoundOn(!soundOn);
  };

  let status = 'Connecting to MTA feeds…';
  if (poll) {
    const failed = poll.failed.length;
    status = poll.ok === 0
      ? 'Can’t reach the MTA feeds — retrying…'
      : `Tracking ${poll.trains} trains · ${arrivalCount} arrivals`
        + (failed ? ` · ${failed} feed${failed > 1 ? 's' : ''} unavailable` : '');
  }

  return (
    <>
      <header>
        <h1>Subway Song</h1>
        <span className={poll?.ok === 0 ? 'status error' : 'status'}>{status}</span>
        <button className="sound" type="button" aria-pressed={soundOn} onClick={toggleSound}>
          Sound: {soundOn ? 'on' : 'off'}
        </button>
      </header>
      {entries.length === 0 && <p className="empty">Waiting for the first train to pull in…</p>}
      <ol className="log">
        {entries.map((entry) => (
          // Rows of a chord of two or more notes are bracketed together.
          <li key={entry.id} className={entry.arrivals.length > 1 ? 'chord' : undefined}>
            {entry.arrivals.map((arrival) => (
              <ArrivalRow key={arrival.id} arrival={arrival} playedAt={entry.playedAt} />
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function ArrivalRow({ arrival, playedAt }: { arrival: PlayedArrival; playedAt: number }) {
  const { label, station, dest, time } = arrival;
  return (
    <div className="row">
      {/* Two times per row: when the feed says the train arrived (reported or
          inferred, and occasionally a few seconds in the future), and when
          its note was played. */}
      <span className="times">arrived {formatArrived(time)} · played {formatPlayed(playedAt)}</span>
      <span
        className="bullet"
        style={{ background: ROUTE_COLORS[label], color: DARK_TEXT_ROUTES.has(label) ? '#000' : undefined }}
      >
        {label === 'SIR' ? 'SI' : label}
      </span>
      <span>train arrived at {station}</span>
      {dest && dest !== station && <span className="dest">→ {dest}</span>}
      <span className="times">{formatSound(arrival)}</span>
    </div>
  );
}
