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
(function (root) {
  const GtfsRt = typeof module !== 'undefined' && module.exports
    ? require('./gtfs-rt.js')
    : root.GtfsRt;

  const FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F';
  const FEEDS = ['gtfs', 'gtfs-ace', 'gtfs-bdfm', 'gtfs-g', 'gtfs-jz', 'gtfs-nqrw', 'gtfs-l', 'gtfs-si'];

  // Per-stop times further than this from the feed's clock are predictions
  // for trains that haven't really arrived (or stale data), not arrival times.
  const MAX_SKEW_SECONDS = 60;

  class ArrivalTracker {
    constructor(onArrival) {
      this.onArrival = onArrival;
      this.trips = new Map(); // trip key -> last known state
      this.seeded = new Set(); // feeds that have been polled at least once
    }

    async pollAll() {
      const results = await Promise.allSettled(FEEDS.map((feed) => this.poll(feed)));
      return {
        ok: results.filter((r) => r.status === 'fulfilled').length,
        failed: FEEDS.filter((_, i) => results[i].status === 'rejected'),
        trains: [...this.trips.values()].filter((t) => t.hasVehicle).length,
      };
    }

    async poll(feed) {
      // The timeout keeps a slow poll from overlapping the next one.
      const res = await fetch(FEED_BASE + feed, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`${feed}: HTTP ${res.status}`);
      this.ingest(feed, GtfsRt.decodeFeed(await res.arrayBuffer()));
    }

    ingest(feed, message) {
      const feedTime = message.header ? message.header.timestamp : Math.floor(Date.now() / 1000);

      // Each trip appears as up to two entities: a trip update (remaining
      // stops) and a vehicle position (where the train is now).
      const current = new Map();
      const entry = (trip) => {
        const key = `${feed}|${trip.startDate}|${trip.tripId}`;
        if (!current.has(key)) current.set(key, { routeId: trip.routeId, stops: [], times: [], vehicle: null });
        return current.get(key);
      };
      for (const entity of message.entity) {
        if (entity.tripUpdate && entity.tripUpdate.trip) {
          const updates = entity.tripUpdate.stopTimeUpdate;
          const e = entry(entity.tripUpdate.trip);
          e.stops = updates.map((s) => s.stopId);
          // The feed's own arrival time for each remaining stop.
          e.times = updates.map((s) => (s.arrival || s.departure || {}).time);
        }
        if (entity.vehicle && entity.vehicle.trip) {
          entry(entity.vehicle.trip).vehicle = entity.vehicle;
        }
      }

      // The first snapshot of a feed only establishes a baseline; trains
      // already sitting in stations are not reported.
      const plausible = (time) => (time && Math.abs(time - feedTime) <= MAX_SKEW_SECONDS ? time : undefined);

      const live = this.seeded.has(feed);
      this.seeded.add(feed);

      for (const [key, trip] of current) {
        const prev = this.trips.get(key);
        const nextStop = trip.stops[0];
        const destination = trip.stops[trip.stops.length - 1] || (prev && prev.destination);
        const stoppedAt = trip.vehicle && trip.vehicle.currentStatus === GtfsRt.STOPPED_AT
          ? trip.vehicle.stopId
          : undefined;
        let lastArrived = prev ? prev.lastArrived : undefined;

        const emit = (stopId, time) => {
          lastArrived = stopId;
          // Only report trains that were already in motion when last seen, so
          // a train being assigned at its origin terminal doesn't count.
          if (live && prev && prev.hasVehicle) {
            this.onArrival({ routeId: trip.routeId, stopId, destination, time, tripId: key });
          }
        };

        if (prev && prev.nextStop && prev.nextStop !== nextStop
            && prev.nextStop !== lastArrived && !trip.stops.includes(prev.nextStop)) {
          emit(prev.nextStop, plausible(prev.nextStopTime) || feedTime);
        }
        if (stoppedAt && stoppedAt !== lastArrived) {
          // Prefer the per-stop arrival time; the vehicle timestamp is only
          // when the position was last refreshed.
          const stopTime = trip.times[trip.stops.indexOf(stoppedAt)]
            || (prev && prev.nextStop === stoppedAt && prev.nextStopTime);
          emit(stoppedAt, plausible(stopTime) || plausible(trip.vehicle.timestamp) || feedTime);
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
        if (live && prev.hasVehicle && prev.remaining === 1 && prev.nextStop !== prev.lastArrived) {
          this.onArrival({
            routeId: prev.routeId, stopId: prev.nextStop, destination: prev.destination,
            time: plausible(prev.nextStopTime) || feedTime, tripId: key,
          });
        }
        this.trips.delete(key);
      }
    }
  }

  const api = { ArrivalTracker, FEEDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof self !== 'undefined' ? self : this);
