"use client";

import { useEffect, useRef } from "react";

/** Deterministic PRNG so a given seed always paints the same palette. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A synthetic "generative film" — flowing seeded light blobs on a dark stage.
 * Used as the demo-mode render surface and as animated gallery thumbnails, so
 * the UI feels alive even with no GPU backend attached.
 */
export default function DemoFilm({
  seed,
  animate = true,
}: {
  seed: number;
  animate?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const doAnimate = animate && !reduce;

    const rand = mulberry32(seed || 1);
    const hueA = rand() * 360;
    const hueB = (hueA + 50 + rand() * 140) % 360;
    const hueC = (hueA + 180 + rand() * 60) % 360;
    const hues = [hueA, hueB, hueC, hueA, hueB];
    const phase = rand() * 10;

    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (now: number) => {
      const t = doAnimate ? (now - start) / 1000 : phase;
      const w = canvas.width;
      const h = canvas.height;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#050507";
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const x =
          w * (0.5 + 0.42 * Math.sin(t * 0.28 + i * 1.7 + phase));
        const y =
          h * (0.5 + 0.4 * Math.cos(t * 0.22 + i * 2.1 + phase * 0.5));
        const rad = Math.min(w, h) * (0.42 + 0.16 * Math.sin(t * 0.5 + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const hue = hues[i];
        g.addColorStop(0, `hsla(${hue}, 88%, 62%, 0.42)`);
        g.addColorStop(0.5, `hsla(${hue}, 82%, 52%, 0.14)`);
        g.addColorStop(1, `hsla(${hue}, 80%, 50%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // subtle vignette
      ctx.globalCompositeOperation = "source-over";
      const vg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.3,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      if (doAnimate) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [seed, animate]);

  return <canvas ref={ref} aria-hidden="true" />;
}
