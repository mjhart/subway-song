const POLL_INTERVAL_MS = 15000;
// Each poll runs this long before the playback period it feeds, so the batch
// is in hand before the period starts.
const POLL_LEAD_MS = 4000;
const MAX_LOG_ENTRIES = 500;

const ROUTE_COLORS = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e',
  4: '#00933c', 5: '#00933c', 6: '#00933c',
  7: '#b933ad',
  A: '#0039a6', C: '#0039a6', E: '#0039a6',
  B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319',
  G: '#6cbe45',
  J: '#996633', Z: '#996633',
  L: '#a7a9ac',
  N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a',
  S: '#808183',
  SIR: '#0039a6',
};
const DARK_TEXT_ROUTES = new Set(['N', 'Q', 'R', 'W']);

// One note of the A major scale per color; the line picks the octave. There
// are more colors than the scale's seven notes, so the four single-line
// colors (L, G, S, SIR) reuse A, B, C# and D in an octave above the lines
// that own those notes.
const ROUTE_NOTES = {
  1: 'A3', 2: 'A4', 3: 'A5',
  4: 'B3', 5: 'B4', 6: 'B5',
  A: 'C#4', C: 'C#5', E: 'C#6',
  B: 'D3', D: 'D4', F: 'D5', M: 'D6',
  N: 'E3', Q: 'E4', R: 'E5', W: 'E6',
  J: 'F#4', Z: 'F#5',
  7: 'G#4',
  L: 'A6',
  G: 'B6',
  S: 'C#7',
  SIR: 'D7',
};
const SEMITONES_FROM_C = { 'A': 9, 'B': 11, 'C#': 1, 'D': 2, 'E': 4, 'F#': 6, 'G#': 8 };
const MIN_NOTE_SECONDS = 0.2;
const MAX_NOTE_SECONDS = 1.5;
// Most arrivals sharing a timestamp that may sound together.
const MAX_CHORD_NOTES = 3;

const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const emptyEl = document.getElementById('empty');
const soundEl = document.getElementById('sound');
let arrivalCount = 0;

// Platform ids are the station id plus a direction suffix (e.g. L06N).
const stationName = (stopId) => stopId && (STATIONS[stopId] || STATIONS[stopId.slice(0, -1)]);

// Express variants (6X, 7X, FX), shuttles (GS, FS, H) and SI share a bullet with their base route.
function bulletLabel(routeId) {
  if (routeId === 'SI' || routeId === 'SS') return 'SIR';
  if (routeId === 'GS' || routeId === 'FS' || routeId === 'H') return 'S';
  return routeId.replace(/X$/, '');
}

function noteFrequency(note) {
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  const midi = 12 * (Number(octave) + 1) + SEMITONES_FROM_C[name];
  return 440 * 2 ** ((midi - 69) / 12);
}

// Browsers only allow audio to start from a user gesture, so the context is
// created on the first click of the sound button.
let audio = null;
let master = null;
let soundOn = false;

soundEl.addEventListener('click', () => {
  if (!audio) {
    audio = new AudioContext();
    master = audio.createGain();
    master.connect(audio.destination);
  }
  soundOn = !soundOn;
  // Mute rather than suspend: suspending would stop the audio clock and make
  // already-scheduled notes play late.
  master.gain.value = soundOn ? 1 : 0;
  soundEl.textContent = soundOn ? 'Sound: on' : 'Sound: off';
  soundEl.setAttribute('aria-pressed', soundOn);
});

function playNote(note, duration, delayMs) {
  if (!audio || !note) return;
  const frequency = noteFrequency(note);
  const start = audio.currentTime + delayMs / 1000;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // High sine tones sound much louder than low ones at equal gain.
  const peak = 0.2 * Math.min(1, Math.sqrt(440 / frequency));
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + duration);
}

// Logs the arrivals whose notes sound together. Each gets a row; rows of a
// chord of two or more notes are bracketed together.
function showChord(arrivals) {
  const playedAt = Date.now();
  const li = document.createElement('li');
  if (arrivals.length > 1) li.className = 'chord';
  li.append(...arrivals.map((arrival) => arrivalRow(arrival, playedAt)));

  // Keep the log newest-first by play time; timers can fire slightly out of
  // order.
  li.dataset.time = playedAt;
  let before = logEl.firstChild;
  while (before && Number(before.dataset.time) > playedAt) before = before.nextSibling;
  logEl.insertBefore(li, before);
  while (logEl.children.length > MAX_LOG_ENTRIES) logEl.lastChild.remove();
  emptyEl.hidden = true;
  arrivalCount += arrivals.length;
}

function arrivalRow({ label, station, dest, time, note, duration }, playedAt) {
  // Two times per row: when the feed says the train arrived (reported or
  // inferred, and occasionally a few seconds in the future), and when its
  // note was played, which is when this row appears.
  const arrived = new Date(time * 1000).toLocaleTimeString();
  const played = new Date(playedAt).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 1,
  });
  const sound = note ? `${note} for ${duration.toFixed(1)}s` : 'no note';
  console.log(`${label} train arrived at ${station}${dest ? ` (to ${dest})` : ''}: arrived ${arrived}, played ${played}, ${sound}`);

  const row = document.createElement('div');
  row.className = 'row';
  const timeEl = document.createElement('span');
  timeEl.className = 'times';
  timeEl.textContent = `arrived ${arrived} · played ${played}`;
  const bullet = document.createElement('span');
  bullet.className = 'bullet';
  bullet.textContent = label === 'SIR' ? 'SI' : label;
  bullet.style.background = ROUTE_COLORS[label] || '';
  if (DARK_TEXT_ROUTES.has(label)) bullet.style.color = '#000';
  const text = document.createElement('span');
  text.textContent = `train arrived at ${station}`;
  row.append(timeEl, bullet, text);
  if (dest && dest !== station) {
    const destEl = document.createElement('span');
    destEl.className = 'dest';
    destEl.textContent = `→ ${dest}`;
    row.append(destEl);
  }
  const noteEl = document.createElement('span');
  noteEl.className = 'times';
  noteEl.textContent = sound;
  row.append(noteEl);
  return row;
}

// Spreads a poll's arrivals across the playback period starting at
// periodStart (a performance.now() time), preserving their relative timing:
// the earliest arrival lands at the start of the period. The span is scaled
// by (n - 1) / n so the latest arrival lands one slot short of the end
// instead of on top of the next period's first note.
//
// Arrivals sharing a timestamp play together as a chord of at most
// MAX_CHORD_NOTES; a bigger group is split into several chords fanned out
// evenly across the gap before the next distinct timestamp.
function scheduleBatch(batch, periodStart) {
  if (!batch.length) return;
  const groups = new Map(); // timestamp -> arrivals
  for (const arrival of batch) {
    if (!groups.has(arrival.time)) groups.set(arrival.time, []);
    groups.get(arrival.time).push(arrival);
  }
  const times = [...groups.keys()].sort((a, b) => a - b);
  const earliest = times[0];
  const span = times[times.length - 1] - earliest;
  const playSpan = POLL_INTERVAL_MS * (batch.length - 1) / batch.length;
  const offsetOf = (time) => (span ? (time - earliest) / span * playSpan : 0);

  times.forEach((time, i) => {
    const group = groups.get(time);
    const offset = offsetOf(time);
    const nextOffset = i + 1 < times.length ? offsetOf(times[i + 1]) : POLL_INTERVAL_MS;
    const chords = Math.ceil(group.length / MAX_CHORD_NOTES);
    // Deal the group out line by line so trains on the same line, which
    // would only double the same pitch, end up in different chords.
    group.sort((a, b) => a.label.localeCompare(b.label));
    for (let c = 0; c < chords; c++) {
      const chord = group.filter((_, j) => j % chords === c);
      const chordOffset = offset + c * (nextOffset - offset) / chords;
      const delayMs = Math.max(0, periodStart + chordOffset - performance.now());
      // The notes go on the audio clock for precise timing; the log rows
      // appear alongside them.
      for (const arrival of chord) {
        arrival.note = ROUTE_NOTES[arrival.label];
        arrival.duration = MIN_NOTE_SECONDS + Math.random() * (MAX_NOTE_SECONDS - MIN_NOTE_SECONDS);
        playNote(arrival.note, arrival.duration, delayMs);
      }
      setTimeout(showChord, delayMs, chord);
    }
  });
}

let batch = [];
const tracker = new ArrivalTracker(({ routeId, stopId, destination, time }) => {
  const station = stationName(stopId);
  // The feeds include internal timing points that aren't passenger stations.
  if (!station) return;
  batch.push({ label: bulletLabel(routeId || '?'), station, dest: stationName(destination), time });
});

// Playback periods run back to back from firstPeriodStart; the poll feeding
// each one fires POLL_LEAD_MS before it begins.
const firstPeriodStart = performance.now() + POLL_LEAD_MS;
let period = 0;

async function tick() {
  const periodStart = firstPeriodStart + period * POLL_INTERVAL_MS;
  period++;
  setTimeout(tick, periodStart + POLL_INTERVAL_MS - POLL_LEAD_MS - performance.now());

  batch = [];
  const { ok, failed, trains } = await tracker.pollAll();
  scheduleBatch(batch, periodStart);

  statusEl.classList.toggle('error', ok === 0);
  statusEl.textContent = ok === 0
    ? 'Can’t reach the MTA feeds — retrying…'
    : `Tracking ${trains} trains · ${arrivalCount} arrivals`
      + (failed.length ? ` · ${failed.length} feed${failed.length > 1 ? 's' : ''} unavailable` : '');
}

tick();
