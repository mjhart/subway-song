import { STATIONS } from './stations';

export const ROUTE_COLORS: Record<string, string> = {
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
export const DARK_TEXT_ROUTES = new Set(['N', 'Q', 'R', 'W']);

/** The scale the notes are drawn from, in order. */
export const SCALE = ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'];

// One note of the A major scale per color; the line picks the octave. There
// are more colors than the scale's seven notes, so the four single-line
// colors (L, G, S, SIR) reuse A, B, C# and D in an octave above the lines
// that own those notes.
//
// The on-site description (components/HowItWorks.tsx) builds its note table
// from this, but its wording about the scale and colors is written by hand.
export const ROUTE_NOTES: Record<string, string> = {
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

// Platform ids are the station id plus a direction suffix (e.g. L06N).
export function stationName(stopId: string | undefined): string | undefined {
  return stopId ? STATIONS[stopId] ?? STATIONS[stopId.slice(0, -1)] : undefined;
}

// Express variants (6X, 7X, FX), shuttles (GS, FS, H) and SI share a bullet with their base route.
export function bulletLabel(routeId: string): string {
  if (routeId === 'SI' || routeId === 'SS') return 'SIR';
  if (routeId === 'GS' || routeId === 'FS' || routeId === 'H') return 'S';
  return routeId.replace(/X$/, '');
}
