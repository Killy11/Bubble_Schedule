import { FCM_SCOPE } from "@/lib/fcm";

/**
 * Show a notification from the page itself (no server involved): through the service worker when there is one,
 * which is the only way that works on Android and in installed PWAs, otherwise with the Notification API.
 * Returns false when the browser has no permission or no way to show it.
 */
export async function showLocalNotification(title: string, body: string, tag?: string): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return false;
  const options: NotificationOptions = { body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag, data: { url: "/dashboard" } };
  try {
    if ("serviceWorker" in navigator) {
      const reg = (await navigator.serviceWorker.getRegistration(FCM_SCOPE)) ?? (await navigator.serviceWorker.getRegistration());
      if (reg) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
