// Turns successive snapshots of the MTA feeds into "train arrived" events.
//
// The feeds are snapshots, not event streams, so arrivals are inferred by
// diffing each poll against the previous one:
//   1. A train's vehicle status becomes STOPPED_AT a stop we haven't yet
//      reported for it.
//   2. Fallback: the train's next stop changed and we never saw it stopped at
//      the old one (it arrived and left between two polls).
//   3. Fallback: the train vanished from the feed while its terminal was the
//      only stop left.

import { decodeFeed, STOPPED_AT, type FeedMessage, type TripDescriptor, type VehiclePosition } from './gtfs-rt';

const FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F';
export const FEEDS = ['gtfs', 'gtfs-ace', 'gtfs-bdfm', 'gtfs-g', 'gtfs-jz', 'gtfs-nqrw', 'gtfs-l', 'gtfs-si'];

// Per-stop times further than this from the feed's clock are predictions
// for trains that haven't really arrived (or stale data), not arrival times.
const MAX_SKEW_SECONDS = 60;

export interface Arrival {
  routeId?: string;
  stopId: string;
  /** Stop id of the trip's last stop. */
  destination?: string;
  /** Unix seconds, as reported by or inferred from the feed. */
  time: number;
  tripId: string;
}

export interface PollResult {
  /** Number of feeds fetched successfully. */
  ok: number;
  failed: string[];
  /** Trains currently being tracked. */
  trains: number;
}

/** A trip as it appears in one feed snapshot. */
interface SnapshotTrip {
  routeId?: string;
  /** Remaining stops, next first. */
  stops: string[];
  /** The feed's own arrival time for each remaining stop. */
  times: (number | undefined)[];
  vehicle: VehiclePosition | null;
}

/** What we remember about a trip between polls. */
interface TripState {
  routeId?: string;
  nextStop?: string;
  nextStopTime?: number;
  remaining: number;
  destination?: string;
  lastArrived?: string;
  hasVehicle: boolean;
}

export class ArrivalTracker {
  private trips = new Map<string, TripState>();
  /** Feeds that have been polled at least once. */
  private seeded = new Set<string>();

  constructor(private onArrival: (arrival: Arrival) => void) {}

  async pollAll(): Promise<PollResult> {
    const results = await Promise.allSettled(FEEDS.map((feed) => this.poll(feed)));
    return {
      ok: results.filter((r) => r.status === 'fulfilled').length,
      failed: FEEDS.filter((_, i) => results[i].status === 'rejected'),
      trains: [...this.trips.values()].filter((t) => t.hasVehicle).length,
    };
  }

  private async poll(feed: string): Promise<void> {
    // The timeout keeps a slow poll from overlapping the next one.
    const res = await fetch(FEED_BASE + feed, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`${feed}: HTTP ${res.status}`);
    this.ingest(feed, decodeFeed(await res.arrayBuffer()));
  }

  ingest(feed: string, message: FeedMessage): void {
    const feedTime = message.header?.timestamp ?? Math.floor(Date.now() / 1000);

    // Each trip appears as up to two entities: a trip update (remaining
    // stops) and a vehicle position (where the train is now).
    const current = new Map<string, SnapshotTrip>();
    const entry = (trip: TripDescriptor): SnapshotTrip => {
      const key = `${feed}|${trip.startDate}|${trip.tripId}`;
      let snapshot = current.get(key);
      if (!snapshot) {
        snapshot = { routeId: trip.routeId, stops: [], times: [], vehicle: null };
        current.set(key, snapshot);
      }
      return snapshot;
    };
    for (const entity of message.entity) {
      if (entity.tripUpdate?.trip) {
        const updates = entity.tripUpdate.stopTimeUpdate;
        const snapshot = entry(entity.tripUpdate.trip);
        snapshot.stops = updates.map((s) => s.stopId ?? '');
        snapshot.times = updates.map((s) => (s.arrival ?? s.departure)?.time);
      }
      if (entity.vehicle?.trip) {
        entry(entity.vehicle.trip).vehicle = entity.vehicle;
      }
    }

    const plausible = (time: number | undefined | false) =>
      (time && Math.abs(time - feedTime) <= MAX_SKEW_SECONDS ? time : undefined);

    // The first snapshot of a feed only establishes a baseline; trains
    // already sitting in stations are not reported.
    const live = this.seeded.has(feed);
    this.seeded.add(feed);

    for (const [key, trip] of current) {
      const prev = this.trips.get(key);
      const nextStop = trip.stops[0] || undefined;
      const destination = trip.stops[trip.stops.length - 1] || prev?.destination;
      const stoppedAt = trip.vehicle?.currentStatus === STOPPED_AT ? trip.vehicle.stopId : undefined;
      let lastArrived = prev?.lastArrived;

      const emit = (stopId: string, time: number) => {
        lastArrived = stopId;
        // Only report trains that were already in motion when last seen, so
        // a train being assigned at its origin terminal doesn't count.
        if (live && prev?.hasVehicle) {
          this.onArrival({ routeId: trip.routeId, stopId, destination, time, tripId: key });
        }
      };

      if (prev?.nextStop && prev.nextStop !== nextStop
          && prev.nextStop !== lastArrived && !trip.stops.includes(prev.nextStop)) {
        emit(prev.nextStop, plausible(prev.nextStopTime) ?? feedTime);
      }
      if (stoppedAt && stoppedAt !== lastArrived) {
        // Prefer the per-stop arrival time; the vehicle timestamp is only
        // when the position was last refreshed.
        const stopTime = trip.times[trip.stops.indexOf(stoppedAt)]
          || (prev?.nextStop === stoppedAt && prev.nextStopTime);
        emit(stoppedAt, plausible(stopTime) ?? plausible(trip.vehicle?.timestamp) ?? feedTime);
      }

      this.trips.set(key, {
        routeId: trip.routeId,
        nextStop,
        nextStopTime: trip.times[0],
        remaining: trip.stops.length,
        destination,
        lastArrived,
        hasVehicle: !!trip.vehicle,
      });
    }

    for (const [key, prev] of this.trips) {
      if (!key.startsWith(feed + '|') || current.has(key)) continue;
      if (live && prev.hasVehicle && prev.remaining === 1 && prev.nextStop && prev.nextStop !== prev.lastArrived) {
        this.onArrival({
          routeId: prev.routeId, stopId: prev.nextStop, destination: prev.destination,
          time: plausible(prev.nextStopTime) ?? feedTime, tripId: key,
        });
      }
      this.trips.delete(key);
    }
  }
}
