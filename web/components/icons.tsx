/* Minimal inline icon set — stroked, currentColor, 1.6 weight. */
import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  width: 18,
  height: 18,
};

export const IconAperture = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3l3.5 6M21 12h-7M18.5 18l-4-6M6 20l3.5-6M3 12h7M8 5l4 6" />
  </svg>
);

export const IconText = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 6h16M4 6v-.5M20 6v-.5M12 6v13M9 19h6" />
  </svg>
);

export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9" r="1.6" />
    <path d="M3 16l5-4 4 3 3-2 6 5" />
  </svg>
);

export const IconInfinity = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M6.5 15.5c-2 0-3.5-1.6-3.5-3.5s1.5-3.5 3.5-3.5c3 0 4 7 8 7 2 0 3.5-1.6 3.5-3.5S17.5 8.5 15.5 8.5c-3 0-4 7-8 7z" />
  </svg>
);

export const IconBolt = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconDice = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1" fill="currentColor" />
    <circle cx="15" cy="15" r="1" fill="currentColor" />
    <circle cx="15" cy="9" r="1" fill="currentColor" />
    <circle cx="9" cy="15" r="1" fill="currentColor" />
  </svg>
);

export const IconSparkle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
  </svg>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </svg>
);

export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} width={22} height={22}>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </svg>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} width={16} height={16}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconVideo = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10l5-3v10l-5-3z" />
  </svg>
);

export const IconAudio = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </svg>
);

export const IconLayers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);

export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} width={15} height={15}>
    <path d="M9 15l6-6M10 6l1-1a4 4 0 016 6l-1 1M14 18l-1 1a4 4 0 01-6-6l1-1" />
  </svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} width={20} height={20}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
