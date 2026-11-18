"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { historyConverter } from "@/lib/firebase/converters";
import type { HistoryRecord } from "@/types";

/** The user's most recent completed-task records, used to suggest realistic durations. */
export function useHistory(uid: string | undefined): HistoryRecord[] {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "users", uid, "history").withConverter(historyConverter),
      orderBy("completedAt", "desc"),
      limit(200),
    );
    return onSnapshot(
      q,
      (snap) => setRecords(snap.docs.map((d) => d.data())),
      (e) => console.warn("history listener:", e.code),
    );
  }, [uid]);
  return records;
}
