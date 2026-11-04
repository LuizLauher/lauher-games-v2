import { useEffect, useRef } from "react";

type Paint = (ctx: CanvasRenderingContext2D) => void;

const PARTS: Paint[] = [
  (ctx) => {
    ctx.beginPath();
    ctx.arc(365, 108, 30, 0, Math.PI * 2);
    ctx.stroke();
  },
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(365, 138);
    ctx.lineTo(365, 218);
    ctx.stroke();
  },
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(365, 158);
    ctx.lineTo(322, 190);
    ctx.stroke();
  },
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(365, 158);
    ctx.lineTo(408, 190);
    ctx.stroke();
  },
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(365, 218);
    ctx.lineTo(328, 265);
    ctx.stroke();
  },
  (ctx) => {
    ctx.beginPath();
    ctx.moveTo(365, 218);
    ctx.lineTo(402, 265);
    ctx.stroke();
  },
];

function paint(canvas: HTMLCanvasElement, mistakes: number, previous: number, progress: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 600;
  const height = 330;
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#8b8ba9";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(95, 292);
  ctx.lineTo(285, 292);
  ctx.moveTo(145, 292);
  ctx.lineTo(145, 42);
  ctx.lineTo(365, 42);
  ctx.lineTo(365, 78);
  ctx.stroke();
  ctx.strokeStyle = "#f472b6";
  ctx.lineWidth = 5;
  const newest = mistakes > previous ? mistakes : -1;
  for (let index = 0; index < mistakes && index < PARTS.length; index += 1) {
    ctx.globalAlpha = index + 1 === newest ? progress : 1;
    PARTS[index]!(ctx);
  }
  ctx.globalAlpha = 1;
}

export function HangmanStage({ mistakes, shake }: { mistakes: number; shake: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const previous = useRef<number | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const from = previous.current ?? mistakes;
    previous.current = mistakes;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const progress = reduce ? 1 : Math.min(1, (now - started) / 280);
      paint(canvas, mistakes, from, progress);
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [mistakes]);

  return (
    <div className={shake ? "gallows is-shaking" : "gallows"}>
      <canvas ref={ref} data-testid="gallows" aria-label="Desenho da forca" role="img" />
    </div>
  );
}
