import * as React from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShimmerLabel } from "../surfaces";

export interface ImageGenerationProps extends React.HTMLAttributes<HTMLDivElement> {
  prompt?: string;
  generating?: boolean;
  resolution?: string;
  onRegenerate?: () => void;
  className?: string;
}

export function ImageGeneration({
  prompt = "",
  generating = true,
  resolution = "1024 × 1024",
  onRegenerate,
  className,
  ...props
}: ImageGenerationProps) {
  // Pre-calculate 8x8 = 64 dots with staggered delay radiating outward
  const dots = React.useMemo(() => {
    return Array.from({ length: 64 }, (_, i) => {
      const row = Math.floor(i / 8);
      const col = i % 8;
      // Staggered wave from top-left / center
      const distance = Math.hypot(col - 3.5, row - 3.5);
      const delay = (distance * 0.12).toFixed(2);
      return { id: i, delay: `${delay}s` };
    });
  }, []);

  return (
    <div
      data-slot="image-generation"
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border border-border/80 bg-muted/20 p-2.5 sm:p-3 overflow-hidden max-w-[260px] sm:max-w-[280px] w-full shadow-xs transition-colors",
        className,
      )}
      {...props}
    >
      {/* Frame Lane: 8x8 pulsing dot grid over a fixed decorative gradient */}
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted/60 flex items-center justify-center select-none border border-border/40">
        {/* Fixed decorative gradient graphic in source */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 pointer-events-none transition-all duration-700 ease-in-out",
            generating ? "blur-2xl opacity-65 scale-105" : "blur-none opacity-90 scale-100",
          )}
          style={{
            background:
              "radial-gradient(ellipse at 25% 25%, oklch(0.7 0.18 240 / 0.45) 0%, transparent 60%), " +
              "radial-gradient(ellipse at 75% 75%, oklch(0.65 0.22 330 / 0.45) 0%, transparent 65%), " +
              "radial-gradient(ellipse at 50% 50%, oklch(0.75 0.15 160 / 0.35) 0%, transparent 70%), " +
              "linear-gradient(135deg, oklch(0.22 0.04 250), oklch(0.12 0.03 260))",
          }}
        />

        {/* 8x8 pulsing dot grid: 64 dots pulse with staggered delay while generating is true, fade to transparent when false */}
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 grid grid-cols-8 grid-rows-8 p-6 sm:p-8 place-items-center transition-opacity duration-500",
            generating ? "opacity-100" : "opacity-0 pointer-events-none",
          )}
        >
          {dots.map((dot) => (
            <div
              key={dot.id}
              className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.7)]"
              style={{
                animation: generating ? "imageGenPulse 1.8s ease-in-out infinite" : "none",
                animationDelay: dot.delay,
              }}
            />
          ))}
        </div>

        {/* Resolution label in mono */}
        <span className="absolute top-2.5 left-2.5 z-10 font-mono text-[11px] font-medium tracking-wider text-white/90 bg-black/55 backdrop-blur-md px-2 py-0.5 rounded border border-white/15 shadow-xs">
          {resolution}
        </span>
      </div>

      {/* Info Lane: prompt or shimmering "Generating" label & optional regenerate button */}
      <div className="flex items-center justify-between gap-3 px-1 pt-0.5 min-h-[28px]">
        <p className="flex-1 min-w-0 text-xs font-mono truncate">
          {generating ? (
            <ShimmerLabel shimmer={true}>Generating{prompt ? `: ${prompt}` : "…"}</ShimmerLabel>
          ) : (
            <span className="text-foreground/90 truncate block">{prompt || "Image generated"}</span>
          )}
        </p>

        {onRegenerate && (
          <button
            type="button"
            aria-label="Regenerate image"
            disabled={generating}
            aria-hidden={generating}
            tabIndex={generating ? -1 : 0}
            onClick={onRegenerate}
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border/70 bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-200 shrink-0",
              generating ? "opacity-0 pointer-events-none" : "opacity-100 cursor-pointer",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default ImageGeneration;
