import { describe, it, expect } from 'vitest';
import { mermaidProblem } from './mermaid';

describe('mermaidProblem', () => {
  it('accepts a valid flowchart', async () => {
    expect(await mermaidProblem('flowchart TD\n  A[Start] -->|go| B[End]')).toBeNull();
  });
  it('reports a syntax error with its reason', async () => {
    const p = await mermaidProblem('flowchart TD\n  A[Start] --> --> B');
    expect(p).toMatch(/Parse error/i);
  });
  it('reports text that is not a diagram', async () => {
    expect(await mermaidProblem('notadiagram\n  a-b')).toMatch(/No diagram type/i);
  });
});
