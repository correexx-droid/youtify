import { useId } from "react";
import { cn } from "../lib/format";

/** The YoutiFy mark: a "Y" drawn as two sound waves meeting in one beat, inside a soft gradient tile. */
export function LogoMark({ className, plain = false }: { className?: string; plain?: boolean }) {
  // Own gradient id per instance: a shared one breaks when the first copy sits in a hidden element.
  const id = `yf-tile-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {!plain && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff5fd2" />
              <stop offset="0.5" stopColor="#a855f7" />
              <stop offset="1" stopColor="#5b2bff" />
            </linearGradient>
          </defs>
          <rect width="48" height="48" rx="14" fill={`url(#${id})`} />
        </>
      )}
      <g fill="none" stroke={plain ? "currentColor" : "#fff"} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 12 L24 25 L35 12" />
        <path d="M24 25 V37" />
      </g>
      <circle cx="35" cy="35" r="3" fill={plain ? "currentColor" : "#fff"} opacity="0.85" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-8" />
      <span className="text-[18px] font-bold tracking-tight">
        Youti<span className="text-accent-text">Fy</span>
      </span>
    </span>
  );
}

/** The playing-track marker: three bouncing bars. */
export function Equalizer({ live, className }: { live: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3.5 items-end gap-[2px]", live && "eq-live", className)}>
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
    </span>
  );
}
