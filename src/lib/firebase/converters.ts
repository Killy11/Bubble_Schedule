import type {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from "firebase/firestore";
import type {
  ChatMessage,
  Device,
  HistoryRecord,
  Reminder,
  Schedule,
  Task,
  User,
} from "@/types";

/**
 * App types use ISO strings; Firestore stores native timestamps.
 * Only these keys hold dates, so strings elsewhere are never touched.
 * The helpers are SDK-agnostic (Date in, duck-typed Timestamp out), so both
 * the client SDK converters below and the Admin SDK can use them.
 */
const DATE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "lastLoginAt",
  "lastSeenAt",
  "deadline",
  "completedAt",
  "startedAt",
  "expiredAt",
  "estimatedAt",
  "start",
  "end",
  "at",
  "fireAt",
  "sentAt",
]);

type TimestampLike = { toDate(): Date };
const isTimestamp = (v: unknown): v is TimestampLike =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as TimestampLike).toDate === "function";

/** Firestore → app: Timestamp → ISO string. */
export function fromFirestoreData<T>(value: unknown, key?: string): T {
  if (key && DATE_KEYS.has(key) && isTimestamp(value)) {
    return value.toDate().toISOString() as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => fromFirestoreData(v)) as T;
  }
  if (value && typeof value === "object" && !isTimestamp(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fromFirestoreData(v, k)]),
    ) as T;
  }
  return value as T;
}

/** App → Firestore: ISO string → Date (both SDKs store Date as a Timestamp). Drops `undefined`. */
export function toFirestoreData(value: unknown, key?: string): unknown {
  if (key && DATE_KEYS.has(key) && typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (Array.isArray(value)) return value.map((v) => toFirestoreData(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, toFirestoreData(v, k)]),
    );
  }
  return value;
}

/** Client-SDK converter. `idField` copies the document id into the model. */
function makeConverter<T extends object>(
  idField?: keyof T & string,
  defaults: Partial<T> = {},
): FirestoreDataConverter<T> {
  return {
    toFirestore(model) {
      const data = toFirestoreData(model) as Record<string, unknown>;
      if (idField) delete data[idField]; // the id lives in the doc path
      return data;
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions) {
      const data = {
        ...defaults,
        ...fromFirestoreData<Record<string, unknown>>(snap.data(options)),
      };
      return (idField ? { ...data, [idField]: snap.id } : data) as T;
    },
  };
}

export const userConverter = makeConverter<User>();
export const taskConverter = makeConverter<Task>("id", { loggedMinutes: 0 });
export const scheduleConverter = makeConverter<Schedule>("dateKey");
export const messageConverter = makeConverter<ChatMessage>("id");
export const deviceConverter = makeConverter<Device>();
export const reminderConverter = makeConverter<Reminder>("id");
export const historyConverter = makeConverter<HistoryRecord>("id");
