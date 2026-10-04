// Minimal GTFS-realtime protobuf decoder. Only the fields needed to track
// train movements are decoded; everything else (including the NYCT
// extensions) is skipped.

export interface TripDescriptor {
  tripId?: string;
  startDate?: string;
  routeId?: string;
}

export interface StopTimeEvent {
  time?: number;
}

export interface StopTimeUpdate {
  arrival?: StopTimeEvent;
  departure?: StopTimeEvent;
  stopId?: string;
}

export interface TripUpdate {
  trip?: TripDescriptor;
  stopTimeUpdate: StopTimeUpdate[];
}

export interface VehiclePosition {
  trip?: TripDescriptor;
  currentStatus?: number;
  timestamp?: number;
  stopId?: string;
}

export interface FeedEntity {
  id?: string;
  tripUpdate?: TripUpdate;
  vehicle?: VehiclePosition;
}

export interface FeedMessage {
  header?: { timestamp?: number };
  entity: FeedEntity[];
}

/** VehiclePosition.currentStatus value for a train standing at a stop. */
export const STOPPED_AT = 1;

const VARINT = 0, FIXED64 = 1, BYTES = 2, FIXED32 = 5;

// field number -> [name, type, repeated?]; type is 'varint', 'string' or a nested schema
type Field = readonly [name: string, type: 'varint' | 'string' | Schema, repeated?: boolean];
interface Schema {
  readonly [fieldNumber: number]: Field;
}

const TripDescriptorSchema: Schema = {
  1: ['tripId', 'string'],
  3: ['startDate', 'string'],
  5: ['routeId', 'string'],
};
const StopTimeEventSchema: Schema = {
  2: ['time', 'varint'],
};
const StopTimeUpdateSchema: Schema = {
  2: ['arrival', StopTimeEventSchema],
  3: ['departure', StopTimeEventSchema],
  4: ['stopId', 'string'],
};
const TripUpdateSchema: Schema = {
  1: ['trip', TripDescriptorSchema],
  2: ['stopTimeUpdate', StopTimeUpdateSchema, true],
};
const VehiclePositionSchema: Schema = {
  1: ['trip', TripDescriptorSchema],
  4: ['currentStatus', 'varint'],
  5: ['timestamp', 'varint'],
  7: ['stopId', 'string'],
};
const FeedEntitySchema: Schema = {
  1: ['id', 'string'],
  3: ['tripUpdate', TripUpdateSchema],
  4: ['vehicle', VehiclePositionSchema],
};
const FeedHeaderSchema: Schema = {
  3: ['timestamp', 'varint'],
};
const FeedMessageSchema: Schema = {
  1: ['header', FeedHeaderSchema],
  2: ['entity', FeedEntitySchema, true],
};

const utf8 = new TextDecoder();

function decode(buf: Uint8Array, schema: Schema, pos: number, end: number): Record<string, unknown> {
  const msg: Record<string, unknown> = {};
  for (const field of Object.values(schema) as Field[]) if (field[2]) msg[field[0]] = [];

  function varint(): number {
    // Multiplication instead of shifts so values above 2^31 (timestamps) survive.
    let result = 0, scale = 1, byte: number;
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
    const field: Field | undefined = schema[Math.floor(tag / 8)];
    let value: unknown;
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
      if (!field || field[1] === 'varint') continue;
      value = field[1] === 'string'
        ? utf8.decode(buf.subarray(start, pos))
        : decode(buf, field[1], start, pos);
    } else {
      throw new Error('Unsupported protobuf wire type ' + wire);
    }
    if (!field) continue;
    if (field[2]) (msg[field[0]] as unknown[]).push(value);
    else msg[field[0]] = value;
  }
  return msg;
}

export function decodeFeed(arrayBuffer: ArrayBuffer): FeedMessage {
  const buf = new Uint8Array(arrayBuffer);
  return decode(buf, FeedMessageSchema, 0, buf.length) as unknown as FeedMessage;
}
