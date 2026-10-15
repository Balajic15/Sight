import React, { useEffect, useRef } from "react";

interface AudioVisualizerProps {
  isActive: boolean;
  isSpeaking: boolean;
  audioLevels?: number[]; // 0 to 1 values
  getFrequencyData?: () => Uint8Array | null;
  className?: string;
  barColor?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isActive,
  isSpeaking,
  getFrequencyData,
  className = "w-full h-12",
  barColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (!isActive) {
        // Idle flat baseline
        ctx.beginPath();
        ctx.strokeStyle = "rgba(156, 163, 175, 0.3)";
        ctx.lineWidth = 2;
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        return;
      }

      const freqData = getFrequencyData ? getFrequencyData() : null;
      const bars = 32;
      const barWidth = Math.max(2, (width / bars) - 2);

      const defaultGradient = ctx.createLinearGradient(0, 0, width, 0);
      if (isSpeaking) {
        defaultGradient.addColorStop(0, "#38bdf8"); // Sky blue
        defaultGradient.addColorStop(1, "#818cf8"); // Indigo
      } else {
        defaultGradient.addColorStop(0, "#34d399"); // Emerald
        defaultGradient.addColorStop(1, "#10b981"); // Green
      }

      ctx.fillStyle = barColor || defaultGradient;

      for (let i = 0; i < bars; i++) {
        let magnitude = 0.15;
        if (freqData && freqData.length > 0) {
          const sampleIdx = Math.floor((i / bars) * (freqData.length / 2));
          magnitude = Math.max(0.08, freqData[sampleIdx] / 255);
        } else {
          // Animated wave simulation when raw analyser isn't hooked
          magnitude = (Math.sin(phase + i * 0.35) * 0.4 + 0.5) * (isSpeaking ? 0.8 : 0.4);
        }

        const barHeight = Math.max(4, magnitude * (height - 6));
        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      phase += isSpeaking ? 0.15 : 0.06;
      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive, isSpeaking, getFrequencyData, barColor]);

  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-lg bg-neutral-900/60 p-2 backdrop-blur-sm ${className}`}>
      <canvas
        ref={canvasRef}
        width={320}
        height={48}
        className="w-full h-full block"
      />
    </div>
  );
};
