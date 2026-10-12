import React, { useEffect, useRef } from "react";

interface AudioWaveformProps {
  analyser: AnalyserNode | null;
  isRecording: boolean;
  className?: string;
  barCount?: number;
}

export function AudioWaveform({
  analyser,
  isRecording,
  className = "",
  barCount = 28,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let bufferLength = 0;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    if (analyser) {
      bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(new ArrayBuffer(bufferLength));
    }

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      if (width <= 0 || height <= 0) {
        if (isRecording) {
          animationFrameRef.current = requestAnimationFrame(render);
        }
        return;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Determine bar dimensions in CSS pixels
      const totalBars = barCount;
      const barWidth = 3;
      const gap = Math.max(2, (width - totalBars * barWidth) / (totalBars - 1));
      const minBarHeight = 3;
      const maxBarHeight = Math.max(minBarHeight, height - 6);

      // Read real audio frequency data if analyser is active and recording
      if (analyser && dataArray && isRecording) {
        analyser.getByteFrequencyData(dataArray);
      }

      // Read computed text color for monochrome rendering
      const computedColor = getComputedStyle(canvas).color || "#ffffff";
      ctx.fillStyle = computedColor;

      for (let i = 0; i < totalBars; i++) {
        let normalized = 0;

        if (analyser && dataArray && isRecording) {
          // Sample across lower-to-mid human vocal frequencies (0 to ~80% of bin count)
          const dataIndex = Math.min(
            dataArray.length - 1,
            Math.floor((i / totalBars) * (dataArray.length * 0.75)),
          );
          const rawVal = dataArray[dataIndex] ?? 0;
          // Apply gentle threshold: noise under 10 is considered silence
          normalized = rawVal > 10 ? (rawVal - 10) / 245 : 0;
        }

        const barHeight = minBarHeight + normalized * (maxBarHeight - minBarHeight);
        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        // Draw clean rounded bar
        ctx.beginPath();
        const radius = barWidth / 2;
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, barWidth, barHeight, radius);
        } else {
          ctx.rect(x, y, barWidth, barHeight);
        }
        ctx.fill();
      }

      ctx.restore();

      if (isRecording) {
        animationFrameRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [analyser, isRecording, barCount]);

  // Adjust canvas pixel resolution to match display size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`h-7 w-full text-foreground/80 ${className}`}
      style={{ display: "block" }}
    />
  );
}
