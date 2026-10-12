import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  MoreVertical,
  SwitchCamera,
  Flashlight,
  Loader2,
  CameraOff,
  RotateCcw,
} from "lucide-react";

export interface CameraPanelProps {
  isOpen: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClose: () => void;
  onFlipCamera?: () => void;
  onToggleTorch?: () => void;
  isTorchOn?: boolean;
  isInitializing?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function CameraPanel({
  isOpen,
  videoRef,
  onClose,
  onFlipCamera,
  onToggleTorch,
  isTorchOn = false,
  isInitializing = false,
  errorMessage = null,
  onRetry,
}: CameraPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  // Reset video readiness when closed or on error
  useEffect(() => {
    if (!isOpen || errorMessage) {
      setIsVideoReady(false);
      setMenuOpen(false);
    }
  }, [isOpen, errorMessage]);

  // Monitor the video element for actual frame arrival
  useEffect(() => {
    if (!isOpen || errorMessage) return;

    const checkReady = () => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0 && v.readyState >= 2) {
        setIsVideoReady(true);
      }
    };

    const interval = setInterval(checkReady, 50);
    const v = videoRef.current;
    if (v) {
      v.addEventListener("loadeddata", checkReady);
      v.addEventListener("playing", checkReady);
      v.addEventListener("canplay", checkReady);
    }

    return () => {
      clearInterval(interval);
      if (v) {
        v.removeEventListener("loadeddata", checkReady);
        v.removeEventListener("playing", checkReady);
        v.removeEventListener("canplay", checkReady);
      }
    };
  }, [isOpen, errorMessage, videoRef]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="camera-panel"
          initial={
            shouldReduceMotion
              ? { opacity: 0 }
              : { y: "100%", opacity: 1 }
          }
          animate={{
            y: 0,
            opacity: 1,
            transition: {
              duration: shouldReduceMotion ? 0.15 : 0.45,
              ease: [0.22, 1, 0.36, 1], // smooth, natural ease-out cubic curve
            },
          }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : {
                  y: "100%",
                  opacity: 1,
                  transition: {
                    duration: shouldReduceMotion ? 0.15 : 0.35,
                    ease: [0.22, 1, 0.36, 1],
                  },
                }
          }
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "60vh",
            maxHeight: "85vh",
            borderTopLeftRadius: "28px",
            borderTopRightRadius: "28px",
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            overflow: "hidden",
            zIndex: 40,
            backgroundColor: "#09090b",
            willChange: "transform",
            transform: "translateZ(0)",
          }}
          className="shadow-2xl border-t border-white/10"
        >
          {/* Live camera video element taking full panel with smooth opacity reveal once first real frame arrives */}
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v && v.videoWidth > 0) setIsVideoReady(true);
            }}
            onCanPlay={() => {
              const v = videoRef.current;
              if (v && v.videoWidth > 0) setIsVideoReady(true);
            }}
            onPlaying={() => setIsVideoReady(true)}
            className={`w-full h-full object-cover pointer-events-none transition-opacity duration-300 ease-out ${
              isVideoReady && !errorMessage ? "opacity-100" : "opacity-0"
            }`}
          />

          {/* Subtle loading indicator while camera initializes (only before frame arrives and when no error) */}
          {!isVideoReady && !errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10 transition-opacity duration-300 bg-zinc-950">
              <div className="flex flex-col items-center gap-3">
                <div className="relative flex items-center justify-center">
                  <div className="absolute h-10 w-10 rounded-full border border-white/15 animate-ping opacity-35" />
                  <Loader2 className="h-6 w-6 animate-spin text-white/80" />
                </div>
                <span className="text-xs font-medium text-white/70 tracking-wide select-none">
                  Starting camera...
                </span>
              </div>
            </div>
          )}

          {/* Camera Permission Denial / Error State Overlay */}
          {errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-20 bg-zinc-950/95 backdrop-blur-xs">
              <div className="h-12 w-12 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400 mb-3 shadow-inner">
                <CameraOff className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">Camera Unavailable</h3>
              <p className="text-xs text-white/70 max-w-xs mb-5 leading-relaxed">
                {errorMessage}
              </p>
              <div className="flex items-center gap-3">
                {onRetry && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-zinc-950 text-xs font-semibold hover:bg-white/90 active:scale-95 transition-all shadow-md cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Try Again
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  className="px-4 py-2 rounded-full bg-white/10 text-white text-xs font-medium hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Minimal Bottom Controls Overlay */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-auto">
            {/* Bottom-left: Small back/close control — stops the video visual immediately */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Stop camera"
              title="Stop camera visual"
              className="relative z-50 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 active:scale-90"
            >
              <ChevronLeft className="h-6 w-6 stroke-[2.4]" />
            </button>

            {/* Bottom-right: Three-dot menu */}
            {!errorMessage && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-label="Camera options"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60 active:scale-95 cursor-pointer"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>

                {/* Minimal popover menu for Flip Camera & Torch — ICONS ONLY */}
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-12 right-0 mb-2 flex items-center gap-1 rounded-full border border-white/10 bg-black/85 p-1.5 shadow-xl backdrop-blur-lg"
                    >
                      {onFlipCamera && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onFlipCamera();
                          }}
                          aria-label="Flip Camera"
                          title="Flip Camera"
                          className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 active:scale-95 cursor-pointer"
                        >
                          <SwitchCamera className="h-5 w-5" />
                        </button>
                      )}
                      {onToggleTorch && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onToggleTorch();
                          }}
                          aria-label="Torch"
                          title="Torch"
                          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors active:scale-95 cursor-pointer ${
                            isTorchOn
                              ? "bg-amber-400/20 text-amber-300"
                              : "text-white hover:bg-white/15"
                          }`}
                        >
                          <Flashlight className="h-5 w-5" />
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
