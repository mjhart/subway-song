import { planBatch } from '@/lib/schedule';
import { MAX_CHORD_NOTES, MAX_NOTE_SECONDS, MIN_NOTE_SECONDS, POLL_INTERVAL_MS } from '@/lib/settings';
import { ROUTE_NOTES, SCALE } from '@/lib/subway';
import Bullet from './Bullet';

// A plain-language description of how arrivals become notes, for a musician
// who will change the rules through a coding agent. The numbers and the note
// table are read from the code, but the wording is written by hand: when the
// rules in lib/schedule.ts, lib/subway.ts or lib/synth.ts change, update the
// text here to match.

const BAR_SECONDS = POLL_INTERVAL_MS / 1000;

const sharp = (note: string) => note.replace('#', '♯');

/** Lines playing each note of the scale, lowest octave first. */
function linesByNote(): { name: string; lines: { label: string; note: string }[] }[] {
  const names = [...SCALE];
  for (const note of Object.values(ROUTE_NOTES)) {
    const name = note.slice(0, -1);
    if (!names.includes(name)) names.push(name);
  }
  return names.map((name) => ({
    name,
    lines: Object.entries(ROUTE_NOTES)
      .filter(([, note]) => note.slice(0, -1) === name)
      .map(([label, note]) => ({ label, note }))
      .sort((a, b) => a.note.localeCompare(b.note)),
  }));
}

// A made-up batch for the worked example: one train alone, two sharing a
// time, five sharing a time (two of them on the same line), one alone.
// Times are seconds after 12:00:00. The example is run through the real
// planBatch, so the timings and groupings shown always match the rules.
const EXAMPLE_BATCH = [
  { label: '1', time: 0 },
  { label: 'A', time: 10 },
  { label: 'Q', time: 10 },
  { label: 'N', time: 20 },
  { label: '4', time: 20 },
  { label: 'N', time: 20 },
  { label: 'D', time: 20 },
  { label: 'G', time: 20 },
  { label: '7', time: 40 },
];

const clock = (seconds: number) => `12:00:${String(seconds).padStart(2, '0')}`;
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);

function Example() {
  const plan = planBatch(EXAMPLE_BATCH, POLL_INTERVAL_MS, MAX_CHORD_NOTES);
  const times = EXAMPLE_BATCH.map((a) => a.time);
  const spanSeconds = Math.max(...times) - Math.min(...times);

  const steps = plan.map((chord) => {
    const time = chord.arrivals[0].time;
    const sharing = EXAMPLE_BATCH.filter((a) => a.time === time).length;
    const siblings = plan.filter((c) => c.arrivals[0].time === time);
    const position = siblings.indexOf(chord);
    let why: string;
    if (sharing === 1) {
      why = 'The only train at this time, so it plays alone.';
    } else if (siblings.length === 1) {
      why = `${capitalize(word(sharing))} trains share this time, so they sound together.`;
    } else if (position === 0) {
      why = `${capitalize(word(sharing))} trains share this time, more than a chord may hold, so they are `
        + `split into ${word(siblings.length)} chords. This is the first.`;
    } else {
      why = 'The rest of that group, moved later into the gap before the next arrival.';
    }
    return { ...chord, time, why, seconds: (chord.offsetMs / 1000).toFixed(1) };
  });

  return (
    <>
      <p>
        Suppose a batch holds these {word(EXAMPLE_BATCH.length)} arrivals, spread over{' '}
        {spanSeconds} seconds of real time. This is the bar they produce, reading left to
        right. Lines stacked on top of each other sound together.
      </p>
      <div className="example-bar" role="img" aria-label="Timeline of the example bar">
        {steps.map((step) => (
          <div
            className="example-chord"
            key={step.offsetMs}
            style={{ left: `${(step.offsetMs / POLL_INTERVAL_MS) * 100}%` }}
          >
            {step.arrivals.map((a, i) => <Bullet key={i} label={a.label} />)}
            <span className="example-tick">{step.seconds}s</span>
          </div>
        ))}
      </div>
      <ol className="example-steps">
        {steps.map((step) => (
          <li key={step.offsetMs} className={step.arrivals.length > 1 ? 'chord' : undefined}>
            <div className="example-notes">
              <strong>{step.seconds}s</strong>
              {step.arrivals.map((a, i) => (
                <span className="about-line" key={i}>
                  <Bullet label={a.label} /> {sharp(ROUTE_NOTES[a.label])}
                </span>
              ))}
            </div>
            <div className="example-why">Arrived {clock(step.time)}. {step.why}</div>
          </li>
        ))}
      </ol>
      <p>
        The {spanSeconds} seconds of arrivals have been squeezed to fit one {BAR_SECONDS}-second
        bar, keeping their proportions. The first arrival sits at the very start, and the last
        lands a little short of the end so that it doesn’t collide with the first note of the
        next bar. The two N trains ended up in different chords, because together they would
        only double the same note.
      </p>
    </>
  );
}

export default function HowItWorks() {
  return (
    <details className="about">
      <summary>How the music is made</summary>
      <div className="about-body">
        <p>
          Every sound you hear is a real train pulling into a real station. This is a description
          of how arrivals become notes, written for someone who wants to change the music. A
          coding agent can change any of these rules if you describe what you want in the terms
          used here.
        </p>

        <h2>What the music is made from</h2>
        <p>
          Every {BAR_SECONDS} seconds the app is handed a <strong>batch</strong>: a list of the
          trains that have arrived at stations since the last batch. You don’t choose how many
          there are. A busy batch holds around 40 to 50 arrivals; late at night there are far
          fewer. For each arrival we know four things:
        </p>
        <ul>
          <li>the <strong>line</strong> (1, A, Q and so on)</li>
          <li>the <strong>station</strong> it arrived at</li>
          <li>the <strong>destination</strong> it is headed for</li>
          <li>the <strong>time</strong> it arrived, to the nearest second</li>
        </ul>
        <p>
          Today only the line and the time affect the sound. The station and destination are
          there to be used but currently do nothing.
        </p>

        <h2>What arrival times allow</h2>
        <p>
          The job is to take one batch and decide which notes to play, and when, during the
          next {BAR_SECONDS} seconds. Think of each batch as one bar of music, {BAR_SECONDS}{' '}
          seconds long. A few facts about arrival times limit what is possible:
        </p>
        <ul>
          <li>
            <strong>The music always runs behind the trains.</strong> We only hear about an
            arrival after it has happened, and then play it in the following bar. A note
            usually sounds somewhere between a few seconds and a minute after its train
            arrived. Nothing can be played at the moment a train pulls in.
          </li>
          <li>
            <strong>Each bar is planned on its own.</strong> When a batch is turned into notes,
            the next batch doesn’t exist yet. The music can’t build towards something in the
            bar to come. It could remember earlier bars, though today it doesn’t.
          </li>
          <li>
            <strong>A batch has to be used up within its bar.</strong> The next batch arrives
            as the bar ends, so every note must start inside these {BAR_SECONDS} seconds. A
            note may ring on past the end of the bar, but none can be held back for later.
          </li>
          <li>
            <strong>Arrival times are coarser than they look.</strong> They are whole seconds,
            and the lettered lines often report many trains with exactly the same time. A
            batch of 45 arrivals usually contains only about 20 different times, so several
            trains sharing a time is normal, not rare.
          </li>
          <li>
            <strong>A batch covers more clock time than a bar.</strong> The arrivals in one
            batch are typically spread over a minute or more of real time, and all of it is
            squeezed into {BAR_SECONDS} seconds. The spacing between notes is in proportion
            to the real spacing, not equal to it: two trains ten seconds apart are heard
            roughly a second or two apart.
          </li>
        </ul>

        <h2>How a batch becomes notes today</h2>
        <h3>Pitch</h3>
        <p>
          Every note comes from the A major scale. A line’s <strong>color</strong> picks the
          note of the scale, and the <strong>line itself</strong> picks the octave. The subway
          has more colors than the scale has notes, so the L, the G, the shuttles and the
          Staten Island Railway reuse A, B, C♯ and D in a high octave of their own.
        </p>
        <table>
          <tbody>
            {linesByNote().map(({ name, lines }) => (
              <tr key={name}>
                <th scope="row">{sharp(name)}</th>
                <td>
                  {lines.map(({ label, note }) => (
                    <span className="about-line" key={label}>
                      <Bullet label={label} /> {sharp(note)}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Timing</h3>
        <p>
          Within a bar, notes are placed in proportion to their arrival times. The earliest
          arrival in the batch plays at the very start of the bar and the latest plays near
          the end. There is no beat or tempo: notes fall wherever the trains put them.
        </p>

        <h3>Chords</h3>
        <p>
          Arrivals that share a time play together as a chord of up to {MAX_CHORD_NOTES}{' '}
          notes. When more than {MAX_CHORD_NOTES} share a time, they are split into several
          chords, spaced evenly across the gap before the next arrival. Trains on the same
          line are put in different chords where possible, because together they would only
          double the same pitch. Beyond that, which notes end up in a chord is chance: nothing
          checks that they sound good together. Chords are marked in the list below with a
          bar down the left edge.
        </p>

        <h3>Length and tone</h3>
        <p>
          Each note lasts a random length between {MIN_NOTE_SECONDS} and {MAX_NOTE_SECONDS}{' '}
          seconds. Every note is a plain sine wave that starts quickly and fades over its
          whole length. Higher notes are played a little quieter so they don’t pierce.
          Otherwise there are no dynamics: every arrival is treated alike.
        </p>

        <h2>A worked example</h2>
        <Example />

        <h2>Changing it</h2>
        <p>
          Tell your coding agent what you want in musical terms and point it at the part to
          change:
        </p>
        <ul>
          <li>Which note each line plays: the line-to-note table in <code>lib/subway.ts</code></li>
          <li>
            When notes fall within the bar, and how chords are formed: <code>lib/schedule.ts</code>
          </li>
          <li>What a note sounds like: <code>lib/synth.ts</code></li>
          <li>
            Bar length, largest chord, shortest and longest note: <code>lib/settings.ts</code>
          </li>
        </ul>
        <p>
          The note table and the numbers on this page are read from those files, so they
          update by themselves. The wording does not, so ask the agent to update this
          description whenever it changes the rules.
        </p>
      </div>
    </details>
  );
}
