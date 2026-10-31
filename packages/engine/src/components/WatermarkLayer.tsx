import React from 'react';
import { AbsoluteFill, Img } from '@kinetic/renderer-compat';
import type { WatermarkConfig } from '../engine/layer-config-schema';

interface WatermarkLayerProps {
  watermark: WatermarkConfig;
}

type Position = WatermarkConfig['position'];

const POSITION_STYLE: Record<Position, React.CSSProperties> = {
  'top-left': { top: 0, left: 0 },
  'top-right': { top: 0, right: 0 },
  'bottom-left': { bottom: 0, left: 0 },
  'bottom-right': { bottom: 0, right: 0 },
};

/**
 * WatermarkLayer
 *
 * Renders a logo or watermark image pinned to one of the four corners.
 * Height scales automatically from the configured width to preserve aspect ratio.
 *
 * Asset path: place the image in `packages/engine/public/assets/` and set
 * `watermark.src` to `/assets/your-logo.png` in `layer-config.json`.
 */
export const WatermarkLayer: React.FC<WatermarkLayerProps> = ({ watermark }) => {
  const positionStyle = POSITION_STYLE[watermark.position];
  const margin = watermark.marginPx;

  // Apply margin by offsetting from the corner using padding on the absolute container
  const offsetStyle: React.CSSProperties = {
    ...(positionStyle.top !== undefined ? { paddingTop: margin } : { paddingBottom: margin }),
    ...(positionStyle.left !== undefined ? { paddingLeft: margin } : { paddingRight: margin }),
  };

  return (
    <AbsoluteFill
      style={{
        ...positionStyle,
        // Constrain the AbsoluteFill to just the corner quadrant to avoid
        // blocking pointer events over the rest of the composition
        width: watermark.widthPx + margin * 2,
        height: 'auto',
        ...offsetStyle,
        pointerEvents: 'none',
      }}
    >
      <Img
        src={watermark.src}
        style={{
          width: watermark.widthPx,
          height: 'auto',
          opacity: watermark.opacity,
        }}
      />
    </AbsoluteFill>
  );
};
