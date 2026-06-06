import { describe, it, expect } from 'vitest';
import React from 'react';
import { findCompositions } from './jsx-traversal';
import type { CompositionConfig } from './composition-registry';

// A stand-in for the real Composition marker
function Composition(_props: CompositionConfig): null {
  return null;
}

const trivialComponent = () => null;

const baseProps = {
  component: trivialComponent,
  fps: 30,
  width: 100,
  height: 100,
  durationInFrames: 30,
};

describe('findCompositions', () => {
  it('finds a single top-level Composition', () => {
    const found: CompositionConfig[] = [];
    const tree = React.createElement(Composition, { id: 'A', ...baseProps });
    findCompositions(tree, Composition, (p) => found.push(p));
    expect(found.map((c) => c.id)).toEqual(['A']);
  });

  it('finds compositions inside a Fragment', () => {
    const found: CompositionConfig[] = [];
    const tree = React.createElement(
      React.Fragment,
      null,
      React.createElement(Composition, { id: 'A', ...baseProps }),
      React.createElement(Composition, { id: 'B', ...baseProps }),
    );
    findCompositions(tree, Composition, (p) => found.push(p));
    expect(found.map((c) => c.id)).toEqual(['A', 'B']);
  });

  it('finds compositions inside an array', () => {
    const found: CompositionConfig[] = [];
    const tree = [
      React.createElement(Composition, { id: 'A', ...baseProps, key: 'a' }),
      React.createElement(Composition, { id: 'B', ...baseProps, key: 'b' }),
    ];
    findCompositions(tree, Composition, (p) => found.push(p));
    expect(found.map((c) => c.id)).toEqual(['A', 'B']);
  });

  it('does NOT recurse through Composition children (they are render-time)', () => {
    const found: CompositionConfig[] = [];
    // A nested Composition inside another Composition's children should be ignored
    const tree = React.createElement(
      Composition,
      { id: 'A', ...baseProps },
      React.createElement(Composition, { id: 'NESTED', ...baseProps }),
    );
    findCompositions(tree, Composition, (p) => found.push(p));
    expect(found.map((c) => c.id)).toEqual(['A']);
  });

  it('handles null, undefined, and booleans without throwing', () => {
    const found: CompositionConfig[] = [];
    findCompositions(null, Composition, (p) => found.push(p));
    findCompositions(undefined, Composition, (p) => found.push(p));
    findCompositions(true, Composition, (p) => found.push(p));
    findCompositions(false, Composition, (p) => found.push(p));
    expect(found).toEqual([]);
  });

  it('ignores plain text nodes', () => {
    const found: CompositionConfig[] = [];
    findCompositions('hello', Composition, (p) => found.push(p));
    findCompositions(42, Composition, (p) => found.push(p));
    expect(found).toEqual([]);
  });

  it('reproduces the engine project layout (Fragment with three Compositions)', () => {
    const found: CompositionConfig[] = [];
    // Mirrors packages/engine/src/index.tsx
    const tree = React.createElement(
      React.Fragment,
      null,
      React.createElement(Composition, { id: 'KineticDocs', ...baseProps }),
      React.createElement(Composition, { id: 'KineticIntro', ...baseProps }),
      React.createElement(Composition, { id: 'KineticOutro', ...baseProps }),
    );
    findCompositions(tree, Composition, (p) => found.push(p));
    expect(found.map((c) => c.id)).toEqual(['KineticDocs', 'KineticIntro', 'KineticOutro']);
  });
});
