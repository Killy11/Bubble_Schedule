import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and linked automatically by Next.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BubbleSchedule",
    short_name: "BubbleSchedule",
    description: "Visual time management: your tasks as glowing bubbles, scheduled by AI.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0c", // splash screen
    theme_color: "#0a0a0c", // OS title bar / status bar
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
