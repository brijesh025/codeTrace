import type { SVGProps } from "react";

export function CodeTraceLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient id="ct-surface" x1="8" x2="40" y1="5" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3A1D28" />
          <stop offset="1" stopColor="#160E13" />
        </linearGradient>
      </defs>
      <rect fill="url(#ct-surface)" height="44" rx="14" width="44" x="2" y="2" />
      <path d="M31.2 12.3a13.2 13.2 0 1 0 0 23.4" stroke="currentColor" strokeLinecap="round" strokeWidth="4.2" />
      <path
        d="M22.5 13.2h17M31 13.2v22.2"
        stroke="#FF5363"
        strokeLinecap="round"
        strokeWidth="4.2"
      />
      <path d="M31 13.2h8.5" stroke="#FFB0B3" strokeLinecap="round" strokeWidth="1.2" />
      <circle cx="31" cy="35.4" fill="#FFB0B3" r="2.1" />
    </svg>
  );
}
