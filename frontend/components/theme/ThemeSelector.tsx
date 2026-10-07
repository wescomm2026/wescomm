"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/lib/theme";

const options: Array<{
  value: ThemePreference;
  label: string;
  detail: string;
  Icon: typeof Sun;
}> = [
  { value: "system", label: "System", detail: "Match this device", Icon: Monitor },
  { value: "light", label: "Light", detail: "Use the light appearance", Icon: Sun },
  { value: "dark", label: "Dark", detail: "Use the dark appearance", Icon: Moon }
];

export function ThemeSelector({ className }: { className?: string }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const CurrentIcon = resolvedTheme === "dark" ? Moon : Sun;
  const currentLabel = options.find((option) => option.value === preference)?.label ?? "System";

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label={`Choose color theme, current setting ${currentLabel}`}
        aria-expanded={open}
        title={`Theme: ${currentLabel}`}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "grid size-10 place-items-center rounded-control border border-transparent text-foreground transition-colors hover:border-border-strong hover:bg-muted sm:size-11",
          open && "border-border-strong bg-muted"
        )}
      >
        <CurrentIcon className="size-5" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="group"
          aria-label="Color theme"
          className="fixed inset-x-3 top-[76px] z-[100] rounded-xl border bg-card p-1.5 text-card-foreground shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-64"
        >
          <p className="px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Appearance
          </p>
          {options.map(({ value, label, detail, Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setPreference(value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-12 w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-muted",
                  selected && "bg-primary/10"
                )}
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md bg-muted", selected && "bg-primary/15 text-primary")}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{detail}</span>
                </span>
                {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
