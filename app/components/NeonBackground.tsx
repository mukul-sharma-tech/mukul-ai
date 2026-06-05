'use client';

import { useEffect, useRef } from 'react';

// Each wave: a slow elongated sine that scrolls left
interface WaveCfg {
  yRatio:    number;   // vertical centre as fraction of height
  amplitude: number;   // px — keep small for gentle look
  freq:      number;   // cycles per pixel (very low = elongated)
  speed:     number;   // phase advance per frame (very low = slow)
  color:     string;
  glow:      string;
  width:     number;   // stroke width
  alpha:     number;
}

const WAVES: WaveCfg[] = [
  { yRatio: 0.20, amplitude: 28, freq: 0.0018, speed: 0.004, color: '#8b5cf6', glow: '#7c3aed', width: 1.8, alpha: 0.7 },
  { yRatio: 0.38, amplitude: 34, freq: 0.0015, speed: 0.003, color: '#06b6d4', glow: '#0891b2', width: 1.8, alpha: 0.7 },
  { yRatio: 0.56, amplitude: 26, freq: 0.0020, speed: 0.005, color: '#d946ef', glow: '#c026d3', width: 1.4, alpha: 0.6 },
  { yRatio: 0.72, amplitude: 30, freq: 0.0016, speed: 0.0035, color: '#3b82f6', glow: '#2563eb', width: 1.4, alpha: 0.6 },
];

// Boats — each tracks one wave
interface BoatState {
  waveIdx: number;
  x:       number;   // current x pixel
  speed:   number;   // px per frame
  color:   string;
  glow:    string;
  scale:   number;
}

// Boat SVG path points (relative, centred at 0,0, pointing right)
// hull bottom → left → right, mast up, sail
function drawBoat(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  tilt: number,           // radians
  scale: number,
  color: string,
  glow: string,
) {
  const s = scale;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  ctx.shadowColor = glow;
  ctx.shadowBlur  = 14;
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;

  // ── Hull ──
  ctx.beginPath();
  ctx.moveTo(-s * 10, 0);
  ctx.bezierCurveTo(-s * 8, s * 7, s * 8, s * 7, s * 10, 0);
  ctx.closePath();
  ctx.globalAlpha = 0.75;
  ctx.fill();

  // ── Mast ──
  ctx.globalAlpha = 0.9;
  ctx.lineWidth   = s * 1.2;
  ctx.beginPath();
  ctx.moveTo(s * 1, 0);
  ctx.lineTo(s * 1, -s * 18);
  ctx.stroke();

  // ── Sail (triangle) ──
  ctx.beginPath();
  ctx.moveTo(s * 1, -s * 17);
  ctx.lineTo(s * 11, -s * 5);
  ctx.lineTo(s * 1,  -s * 1);
  ctx.closePath();
  ctx.globalAlpha = 0.45;
  ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.lineWidth   = s * 0.8;
  ctx.stroke();

  // ── Flag ──
  ctx.beginPath();
  ctx.moveTo(s * 1,  -s * 18);
  ctx.lineTo(s * 5,  -s * 16);
  ctx.lineTo(s * 1,  -s * 14);
  ctx.closePath();
  ctx.globalAlpha = 0.9;
  ctx.fill();

  ctx.restore();
}

function waveY(cfg: WaveCfg, x: number, phase: number): number {
  return cfg.amplitude * Math.sin(cfg.freq * x + phase);
}

export default function NeonBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  // Per-wave phase accumulator
  const phases = useRef<number[]>(WAVES.map(() => 0));

  // Boats (mutable ref, not state — no re-render needed)
  const boats = useRef<BoatState[]>([
    { waveIdx: 0, x: 0.15, speed: 0.35, color: '#c4b5fd', glow: '#8b5cf6', scale: 0.85 },
    { waveIdx: 1, x: 0.50, speed: 0.25, color: '#67e8f9', glow: '#06b6d4', scale: 0.75 },
    { waveIdx: 2, x: 0.78, speed: 0.40, color: '#f0abfc', glow: '#d946ef', scale: 0.80 },
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      // Reset boat x to pixel coords after resize
      boats.current = boats.current.map(b => ({
        ...b,
        x: b.x * canvas.width,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    // initialise boat x as pixels
    boats.current = boats.current.map(b => ({
      ...b,
      x: b.x * canvas.width,
    }));

    const frame = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // ── Advance wave phases ──
      WAVES.forEach((cfg, i) => { phases.current[i] -= cfg.speed; });

      // ── Draw waves ──
      WAVES.forEach((cfg, i) => {
        const baseY = cfg.yRatio * H;
        const phase = phases.current[i];

        // Glow halo (thick, transparent)
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = baseY + waveY(cfg, x, phase);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.shadowColor = cfg.glow;
        ctx.shadowBlur  = 20;
        ctx.strokeStyle = cfg.glow;
        ctx.lineWidth   = cfg.width + 4;
        ctx.globalAlpha = 0.12;
        ctx.stroke();

        // Crisp neon line
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = baseY + waveY(cfg, x, phase);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.shadowBlur  = 8;
        ctx.strokeStyle = cfg.color;
        ctx.lineWidth   = cfg.width;
        ctx.globalAlpha = cfg.alpha;
        ctx.stroke();

        ctx.shadowBlur  = 0;
        ctx.globalAlpha = 1;
      });

      // ── Draw boats ──
      boats.current.forEach(boat => {
        boat.x += boat.speed;
        if (boat.x > W + 60) boat.x = -60;

        const cfg   = WAVES[boat.waveIdx];
        const phase = phases.current[boat.waveIdx];
        const baseY = cfg.yRatio * H;
        const cy    = baseY + waveY(cfg, boat.x, phase);

        // Tilt = local slope of the wave
        const dx   = 8;
        const y1   = waveY(cfg, boat.x - dx, phase);
        const y2   = waveY(cfg, boat.x + dx, phase);
        const tilt = Math.atan2(y2 - y1, dx * 2) * 0.55;

        // Sit boat on top of the wave crest
        const boatCy = cy - boat.scale * 8;

        drawBoat(ctx, boat.x, boatCy, tilt, boat.scale, boat.color, boat.glow);

        // Wake
        ctx.save();
        const wakeLen = 24 * boat.scale;
        const grad = ctx.createLinearGradient(boat.x - wakeLen, 0, boat.x, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, boat.glow + '66');
        ctx.strokeStyle = grad;
        ctx.lineWidth   = 1.2;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(boat.x - wakeLen, cy + boat.scale * 6);
        ctx.lineTo(boat.x - 2,       cy + boat.scale * 6);
        ctx.stroke();
        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 bg-[#050508]">
      {/* Soft radial glows */}
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-violet-700/20 blur-[120px] animate-pulse-slow" />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-cyan-600/15 blur-[120px] animate-pulse-slow2" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-fuchsia-700/10 blur-[100px] animate-pulse-slow3" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
