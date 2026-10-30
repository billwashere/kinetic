import fs from 'fs-extra';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { FrontmatterSchema } from './schema';
import type { Diagnostic, ParsedNode } from './model';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Pure: parse one knowledge file. `file` is only used for diagnostics. */
export function parseNodeFile(
  raw: string,
  file: string,
): { node?: ParsedNode; diagnostics: Diagnostic[] } {
  const bad = (code: string, message: string) => ({
    diagnostics: [{ severity: 'error' as const, code, message, file }],
  });

  const m = FM_RE.exec(raw.replace(/^﻿/, ''));
  if (!m) return bad('malformed-frontmatter', 'file must start with a "---" delimited YAML block');

  let data: unknown;
  try {
    data = parseYaml(m[1]);
  } catch (e) {
    return bad('malformed-frontmatter', `YAML parse error: ${(e as Error).message.split('\n')[0]}`);
  }

  const result = FrontmatterSchema.safeParse(data);
  if (!result.success) {
    const nodeId =
      typeof (data as { id?: unknown })?.id === 'string' ? (data as { id: string }).id : undefined;
    return {
      diagnostics: result.error.issues.map((i) => ({
        severity: 'error' as const,
        code: 'invalid-frontmatter',
        message: `${i.path.join('.') || '(root)'}: ${i.message}`,
        file,
        nodeId,
      })),
    };
  }

  const fm = result.data;
  return {
    node: { file, ...fm, body: (m[2] ?? '').replace(/\r\n/g, '\n').trim() },
    diagnostics: [],
  };
}

async function listMarkdown(dir: string): Promise<string[]> {
  if (!(await fs.pathExists(dir))) return [];
  const out: string[] = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listMarkdown(p)));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Loads every `*.md` under `dir`. File paths in results are relative to `relativeTo` with `/` separators. */
export async function loadKnowledgeDir(
  dir: string,
  relativeTo: string,
): Promise<{ nodes: ParsedNode[]; diagnostics: Diagnostic[] }> {
  const nodes: ParsedNode[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const abs of await listMarkdown(dir)) {
    const rel = path.relative(relativeTo, abs).split(path.sep).join('/');
    const parsed = parseNodeFile(await fs.readFile(abs, 'utf8'), rel);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.node) nodes.push(parsed.node);
  }
  return { nodes, diagnostics };
}
