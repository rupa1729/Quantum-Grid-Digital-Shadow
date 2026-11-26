import { useEffect, useRef, useState } from 'react';

export type ThemeTurnDirection = 'idle' | 'opening' | 'closing';

interface ThemePageTurnOverlayProps {
  direction: ThemeTurnDirection;
  onCommitTheme: () => void;
  onComplete: () => void;
}

interface TurnGeometry {
  sheetPath: string;
  flapPath: string;
  shadowPath: string;
  creaseP1: { x: number; y: number };
  creaseP2: { x: number; y: number };
  gradStart: { x: number; y: number };
  flapGradEnd: { x: number; y: number };
  shadowGradEnd: { x: number; y: number };
  overlayOpacity: number;
  hasFold: boolean;
}

const FULL_VIEWPORT_PATH = 'M 1000 0 L 1000 1000 L 0 1000 L 0 0 Z';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function buildTurnGeometry(s: number, overlayOpacity: number): TurnGeometry {
  const clampedS = Math.max(0, Math.min(2, s));

  if (clampedS <= 0.001) {
    return {
      sheetPath: '',
      flapPath: '',
      shadowPath: '',
      creaseP1: { x: 1000, y: 0 },
      creaseP2: { x: 1000, y: 0 },
      gradStart: { x: 1000, y: 0 },
      flapGradEnd: { x: 1000, y: 0 },
      shadowGradEnd: { x: 1000, y: 0 },
      overlayOpacity,
      hasFold: false,
    };
  }

  if (clampedS >= 1.999) {
    return {
      sheetPath: FULL_VIEWPORT_PATH,
      flapPath: '',
      shadowPath: '',
      creaseP1: { x: 0, y: 1000 },
      creaseP2: { x: 0, y: 1000 },
      gradStart: { x: 0, y: 1000 },
      flapGradEnd: { x: 0, y: 1000 },
      shadowGradEnd: { x: 0, y: 1000 },
      overlayOpacity,
      hasFold: false,
    };
  }

  const creaseP1 =
    clampedS <= 1
      ? { x: 1000, y: 1000 * clampedS }
      : { x: 1000 * (2 - clampedS), y: 1000 };

  const creaseP2 =
    clampedS <= 1
      ? { x: 1000 * (1 - clampedS), y: 0 }
      : { x: 0, y: 1000 * (clampedS - 1) };

  const sheetPath =
    clampedS <= 1
      ? `M 1000 0 L ${creaseP1.x.toFixed(1)} ${creaseP1.y.toFixed(1)} L ${creaseP2.x.toFixed(1)} ${creaseP2.y.toFixed(1)} Z`
      : `M 1000 0 L 1000 1000 L ${creaseP1.x.toFixed(1)} ${creaseP1.y.toFixed(1)} L ${creaseP2.x.toFixed(1)} ${creaseP2.y.toFixed(1)} L 0 0 Z`;

  const span = Math.min(clampedS, 2 - clampedS) * 1000;
  const maxFlapDepth = span * 0.48;
  const archWave = Math.pow(Math.sin((clampedS / 2) * Math.PI), 0.72);
  const flapDepth = Math.min(maxFlapDepth, 215 * archWave);
  const shadowDepth = Math.max(14, flapDepth * 0.68);

  const midX = (creaseP1.x + creaseP2.x) / 2;
  const midY = (creaseP1.y + creaseP2.y) / 2;
  const dx = creaseP1.x - creaseP2.x;
  const dy = creaseP1.y - creaseP2.y;

  // Curved backside paper flap along the upper-right side of the fold crease
  const ctrl1X = Math.min(1000, creaseP1.x - dx * 0.22 + flapDepth * 1.18);
  const ctrl1Y = Math.max(0, creaseP1.y - dy * 0.22 - flapDepth * 1.18);
  const ctrl2X = Math.min(1000, creaseP2.x + dx * 0.22 + flapDepth * 1.18);
  const ctrl2Y = Math.max(0, creaseP2.y + dy * 0.22 - flapDepth * 1.18);

  const flapPath = `M ${creaseP1.x.toFixed(1)} ${creaseP1.y.toFixed(1)} C ${ctrl1X.toFixed(1)} ${ctrl1Y.toFixed(1)} ${ctrl2X.toFixed(1)} ${ctrl2Y.toFixed(1)} ${creaseP2.x.toFixed(1)} ${creaseP2.y.toFixed(1)} Z`;

  // Soft diagonal cast shadow falling onto the underlying page ahead of the crease
  const sh1X = creaseP1.x - shadowDepth;
  const sh1Y = creaseP1.y + shadowDepth;
  const sh2X = creaseP2.x - shadowDepth;
  const sh2Y = creaseP2.y + shadowDepth;

  const shadowPath = `M ${creaseP1.x.toFixed(1)} ${creaseP1.y.toFixed(1)} L ${creaseP2.x.toFixed(1)} ${creaseP2.y.toFixed(1)} L ${sh2X.toFixed(1)} ${sh2Y.toFixed(1)} L ${sh1X.toFixed(1)} ${sh1Y.toFixed(1)} Z`;

  return {
    sheetPath,
    flapPath,
    shadowPath,
    creaseP1,
    creaseP2,
    gradStart: { x: midX, y: midY },
    flapGradEnd: { x: midX + flapDepth, y: midY - flapDepth },
    shadowGradEnd: { x: midX - shadowDepth, y: midY + shadowDepth },
    overlayOpacity,
    hasFold: flapDepth > 2,
  };
}

export function ThemePageTurnOverlay({
  direction,
  onCommitTheme,
  onComplete,
}: ThemePageTurnOverlayProps) {
  const [geometry, setGeometry] = useState<TurnGeometry | null>(null);
  const commitRef = useRef(onCommitTheme);
  const completeRef = useRef(onComplete);

  commitRef.current = onCommitTheme;
  completeRef.current = onComplete;

  useEffect(() => {
    if (direction === 'idle') {
      setGeometry(null);
      return;
    }

    let rafId = 0;
    let committed = false;

    if (direction === 'closing') {
      // Light -> Dark: cover screen immediately with crisp white paper sheet, commit dark underneath on frame 1,
      // then curl and turn the white page closed diagonally into the top-right corner.
      const peelDurationMs = 640;
      let startTime: number | null = null;
      setGeometry(buildTurnGeometry(2, 1));

      const step = (now: number) => {
        if (!committed) {
          committed = true;
          commitRef.current();
          startTime = now;
          rafId = window.requestAnimationFrame(step);
          return;
        }

        const elapsed = now - (startTime ?? now);
        const progress = Math.min(1, elapsed / peelDurationMs);
        const eased = easeInOutCubic(progress);
        const s = 2 * (1 - eased);
        const opacity = progress > 0.88 ? 1 - (progress - 0.88) / 0.12 : 1;

        setGeometry(buildTurnGeometry(s, Math.max(0, opacity)));

        if (progress < 1) {
          rafId = window.requestAnimationFrame(step);
        } else {
          setGeometry(null);
          completeRef.current();
        }
      };

      rafId = window.requestAnimationFrame(step);
    } else {
      // Dark -> Light: peel and unfold the crisp white paper page open from the top-right corner across the screen,
      // commit light theme at full coverage, then dissolve cleanly into the light surface.
      const unfoldDurationMs = 560;
      const fadeDurationMs = 150;
      const startTime = performance.now();
      setGeometry(buildTurnGeometry(0, 1));

      const step = (now: number) => {
        const elapsed = now - startTime;

        if (elapsed < unfoldDurationMs) {
          const progress = Math.min(1, elapsed / unfoldDurationMs);
          const eased = easeInOutCubic(progress);
          setGeometry(buildTurnGeometry(2 * eased, 1));
          rafId = window.requestAnimationFrame(step);
          return;
        }

        if (!committed) {
          committed = true;
          commitRef.current();
        }

        const fadeProgress = Math.min(1, (elapsed - unfoldDurationMs) / fadeDurationMs);
        setGeometry(buildTurnGeometry(2, Math.max(0, 1 - fadeProgress)));

        if (fadeProgress < 1) {
          rafId = window.requestAnimationFrame(step);
        } else {
          setGeometry(null);
          completeRef.current();
        }
      };

      rafId = window.requestAnimationFrame(step);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [direction]);

  if (direction === 'idle' || !geometry) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden select-none"
    >
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        opacity={geometry.overlayOpacity}
        className="h-full w-full block"
      >
        <defs>
          <linearGradient id="paperSheetSurface" x1="1000" y1="0" x2="0" y2="1000" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="52%" stopColor="#F8FAFC" />
            <stop offset="100%" stopColor="#F1F5F9" />
          </linearGradient>

          <linearGradient
            id="paperCurlUnderside"
            x1={geometry.gradStart.x}
            y1={geometry.gradStart.y}
            x2={geometry.flapGradEnd.x}
            y2={geometry.flapGradEnd.y}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.92" />
            <stop offset="14%" stopColor="#E2E8F0" stopOpacity="0.98" />
            <stop offset="44%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="80%" stopColor="#F8FAFC" stopOpacity="0.98" />
            <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient
            id="paperFoldCastShadow"
            x1={geometry.gradStart.x}
            y1={geometry.gradStart.y}
            x2={geometry.shadowGradEnd.x}
            y2={geometry.shadowGradEnd.y}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#0F172A" stopOpacity="0.44" />
            <stop offset="28%" stopColor="#0F172A" stopOpacity="0.2" />
            <stop offset="68%" stopColor="#0F172A" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
          </linearGradient>

          <clipPath id="paperSheetBoundary">
            <path d={geometry.sheetPath} />
          </clipPath>
        </defs>

        {geometry.hasFold && (
          <path d={geometry.shadowPath} fill="url(#paperFoldCastShadow)" />
        )}

        {geometry.sheetPath && (
          <path d={geometry.sheetPath} fill="url(#paperSheetSurface)" />
        )}

        {geometry.hasFold && (
          <g clipPath="url(#paperSheetBoundary)">
            <path d={geometry.flapPath} fill="url(#paperCurlUnderside)" />
            <line
              x1={geometry.creaseP1.x}
              y1={geometry.creaseP1.y}
              x2={geometry.creaseP2.x}
              y2={geometry.creaseP2.y}
              stroke="#CBD5E1"
              strokeWidth="2.5"
              strokeOpacity="0.85"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
