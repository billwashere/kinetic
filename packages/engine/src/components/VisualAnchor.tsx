import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualAnchorProps {
  anchor?: BoundingBox | null;
}

// Draws a pulsing spotlight over the exact HTML element Playwright interacted with.
export const VisualAnchor: React.FC<VisualAnchorProps> = ({ anchor }) => {
  const frame = useCurrentFrame();

  if (!anchor) return null;

  // Derived once per render — not recomputed inline inside the JSX.
  const opacity = ((Math.sin(frame / 5) + 1) / 2) * 0.6 + 0.4;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: anchor.x - 5,
    top: anchor.y - 5,
    width: anchor.width + 10,
    height: anchor.height + 10,
    border: `4px solid rgba(59, 130, 246, ${opacity})`,
    borderRadius: '8px',
    // Vignette: darkens everything outside the anchor box
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
  };

  return (
    <AbsoluteFill>
      <div style={style} />
    </AbsoluteFill>
  );
};
