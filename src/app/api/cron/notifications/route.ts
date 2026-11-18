// Older cron-job.org setups call this URL: it now runs the same dispatcher (one source of alerts, no double sends).
export { GET, POST, maxDuration } from "@/app/api/notifications/dispatch/route";
