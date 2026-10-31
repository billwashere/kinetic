/**
 * Mermaid diagram checks. A diagram that does not parse is a build error, not something readers discover
 * as raw text in the page. Rendering itself needs a browser's layout engine, so the portal draws the
 * diagrams in the page; this only checks the syntax, which mermaid can do in plain Node once the few
 * DOM globals it touches exist (provided by jsdom).
 */

type MermaidApi = { parse(text: string): Promise<{ diagramType: string } | false> };
let loaded: Promise<MermaidApi> | null = null;

function load(): Promise<MermaidApi> {
  loaded ??= (async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>');
    const g = globalThis as Record<string, unknown>;
    g.window ??= dom.window;
    g.document ??= dom.window.document;
    if (!('navigator' in g) || !g.navigator)
      Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
    const mod = await import('mermaid');
    return mod.default as unknown as MermaidApi;
  })();
  return loaded;
}

/** Returns a one-line reason when the diagram does not parse, or null when it is valid. */
export async function mermaidProblem(source: string): Promise<string | null> {
  try {
    await (await load()).parse(source);
    return null;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return msg.split('\n').filter(Boolean).slice(0, 2).join(' ').slice(0, 200);
  }
}
