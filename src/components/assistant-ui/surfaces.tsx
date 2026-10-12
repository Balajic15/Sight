import * as React from "react";
import { cn } from "@/lib/utils";

export interface ShimmerLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  shimmer?: boolean;
}

export function ShimmerLabel({ children, className, shimmer = true, ...props }: ShimmerLabelProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono text-xs",
        shimmer
          ? "bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-shimmer"
          : "text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
