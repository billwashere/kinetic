/**
 * jsx-traversal.ts
 *
 * Walks the JSX tree returned by registerRoot's factory function and extracts
 * every <Composition> entry it encounters.
 *
 * This is the only piece of logic that bridges "user wrote JSX" → "we have a
 * list of compositions to render".  It's pure, depends only on React, and is
 * easy to unit-test without spinning up Playwright.
 */

import React from 'react';
import type { CompositionConfig } from './composition-registry';

/**
 * The traversal needs to know which component type means "this is a
 * Composition entry" — passed in to avoid a circular import with react-api.
 */
export type CompositionMarker = React.ComponentType<unknown>;

/**
 * Walks `node` recursively and calls `onComposition(props)` for every element
 * whose type === marker.  Handles fragments, arrays, and ordinary wrapper
 * components by recursing into their children.
 */
export function findCompositions(
  node: React.ReactNode,
  marker: CompositionMarker,
  onComposition: (props: CompositionConfig) => void,
): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;

  if (Array.isArray(node)) {
    for (const child of node) findCompositions(child, marker, onComposition);
    return;
  }

  // Strings and numbers are valid React nodes but cannot contain compositions
  if (typeof node === 'string' || typeof node === 'number') return;

  if (React.isValidElement(node)) {
    if (node.type === marker) {
      onComposition(node.props as unknown as CompositionConfig);
      return; // Composition is a leaf — its children are render-time, not registry-time
    }

    // Recurse into children (handles React.Fragment and any wrapper component
    // whose children are passed through verbatim, which is the common case).
    const props = node.props as { children?: React.ReactNode } | null;
    if (props && 'children' in props) {
      findCompositions(props.children, marker, onComposition);
    }
  }
}
