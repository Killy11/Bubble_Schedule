import type { CSSProperties, ReactNode } from "react";

/** Traffic-light hues by time left: red = under a day, yellow = 1–5 days, green = 5+ days or no deadline. */
export type Hue = "red" | "yellow" | "green";

export function Orb({
  hue = "green",
  size,
  className = "",
  style,
  children,
}: {
  hue?: Hue;
  size?: number; // omit to fill the parent
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={`orb orb-${hue} ${className}`}
      style={size ? { width: size, height: size, ...style } : { width: "100%", height: "100%", ...style }}
    >
      {children}
    </div>
  );
}
