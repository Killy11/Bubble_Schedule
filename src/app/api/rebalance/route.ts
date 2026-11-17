import { NextResponse } from "next/server";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { rebalanceAll } from "@/lib/server/rebalance";

export const maxDuration = 60;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Re-plan everything. Called by the app whenever a task is created, edited, deleted or restored. */
export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: { nowISO?: string };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  if (!body.nowISO || Number.isNaN(Date.parse(body.nowISO))) return err("nowISO is invalid", 400);
  const now = new Date(body.nowISO);
  if (Math.abs(now.getTime() - Date.now()) > 10 * 60_000) return err("Your device clock looks wrong", 400);

  return NextResponse.json(await rebalanceAll(uid, now));
}
