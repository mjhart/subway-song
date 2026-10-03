// Minimal GTFS-realtime protobuf decoder. Only the fields needed to track
// train movements are decoded; everything else (including the NYCT
// extensions) is skipped.
(function (root) {
  const VARINT = 0, FIXED64 = 1, BYTES = 2, FIXED32 = 5;

  // field number -> [name, type, repeated?]; type is 'varint', 'string' or a nested schema
  const TripDescriptor = {
    1: ['tripId', 'string'],
    3: ['startDate', 'string'],
    5: ['routeId', 'string'],
  };
  const StopTimeEvent = {
    2: ['time', 'varint'],
  };
  const StopTimeUpdate = {
    2: ['arrival', StopTimeEvent],
    3: ['departure', StopTimeEvent],
    4: ['stopId', 'string'],
  };
  const TripUpdate = {
    1: ['trip', TripDescriptor],
    2: ['stopTimeUpdate', StopTimeUpdate, true],
  };
  const VehiclePosition = {
    1: ['trip', TripDescriptor],
    4: ['currentStatus', 'varint'],
    5: ['timestamp', 'varint'],
    7: ['stopId', 'string'],
  };
  const FeedEntity = {
    1: ['id', 'string'],
    3: ['tripUpdate', TripUpdate],
    4: ['vehicle', VehiclePosition],
  };
  const FeedHeader = {
    3: ['timestamp', 'varint'],
  };
  const FeedMessage = {
    1: ['header', FeedHeader],
    2: ['entity', FeedEntity, true],
  };

  const utf8 = new TextDecoder();

  function decode(buf, schema, pos, end) {
    const msg = {};
    for (const n in schema) if (schema[n][2]) msg[schema[n][0]] = [];

    function varint() {
      // Multiplication instead of shifts so values above 2^31 (timestamps) survive.
      let result = 0, scale = 1, byte;
      do {
        byte = buf[pos++];
        result += (byte & 0x7f) * scale;
        scale *= 128;
      } while (byte & 0x80);
      return result;
    }

    while (pos < end) {
      const tag = varint();
      const wire = tag & 7;
      const field = schema[Math.floor(tag / 8)];
      let value;
      if (wire === VARINT) {
        value = varint();
      } else if (wire === FIXED64) {
        pos += 8;
        continue;
      } else if (wire === FIXED32) {
        pos += 4;
        continue;
      } else if (wire === BYTES) {
        const len = varint();
        const start = pos;
        pos += len;
        if (!field) continue;
        value = field[1] === 'string'
          ? utf8.decode(buf.subarray(start, pos))
          : decode(buf, field[1], start, pos);
      } else {
        throw new Error('Unsupported protobuf wire type ' + wire);
      }
      if (!field) continue;
      if (field[2]) msg[field[0]].push(value);
      else msg[field[0]] = value;
    }
    return msg;
  }

  const GtfsRt = {
    STOPPED_AT: 1,
    decodeFeed(arrayBuffer) {
      const buf = new Uint8Array(arrayBuffer);
      return decode(buf, FeedMessage, 0, buf.length);
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GtfsRt;
  else root.GtfsRt = GtfsRt;
})(typeof self !== 'undefined' ? self : this);
