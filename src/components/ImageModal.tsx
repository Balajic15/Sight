import React from "react";
import { X, Download, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ImageModalProps {
  src: string | null;
  alt?: string;
  onClose: () => void;
}

export function ImageModal({ src, alt = "Image preview", onClose }: ImageModalProps) {
  if (!src) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl bg-background border border-border shadow-2xl flex flex-col"
        >
          {/* Header controls */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/40">
            <span className="text-xs font-medium text-muted-foreground truncate max-w-xs sm:max-w-md">
              {alt}
            </span>
            <div className="flex items-center gap-1">
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                download
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                title="Open or download image"
              >
                <Download className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Image */}
          <div className="flex items-center justify-center p-2 overflow-auto max-h-[80vh]">
            <img
              src={src}
              alt={alt}
              className="max-h-[78vh] w-auto max-w-full rounded-lg object-contain shadow-sm select-none"
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
