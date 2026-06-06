/**
 * composition-registry.ts
 *
 * A simple module-level registry that stores all <Composition> definitions
 * encountered when registerRoot's factory JSX is traversed.  Both the browser
 * runner (frame rendering) and the Node.js selectComposition helper read from
 * this store.
 */

import type React from 'react';

export interface CompositionConfig {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultProps?: Record<string, any>;
}

/** Serialisable subset sent to Puppeteer / selectComposition (no component fn). */
export type CompositionMeta = Omit<CompositionConfig, 'component'>;

const registry: CompositionConfig[] = [];

export function registerComposition(config: CompositionConfig): void {
  const idx = registry.findIndex((c) => c.id === config.id);
  if (idx >= 0) registry[idx] = config;
  else registry.push(config);
}

export function getRegistry(): CompositionConfig[] {
  return [...registry];
}

export function findComposition(id: string): CompositionConfig | undefined {
  return registry.find((c) => c.id === id);
}
