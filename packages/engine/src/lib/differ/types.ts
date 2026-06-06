export type Severity = 'breaking' | 'warning' | 'info';
export type Category = 'structural' | 'anchor' | 'visual';

export interface Finding {
  severity: Severity;
  category: Category;
  pageId: string;
  stepId?: string;
  message: string;
  // Structured payload for machine-readable consumers (CI bots, Slack, PR comments)
  detail?: Record<string, unknown>;
}

export interface DiffReport {
  from: string;
  to: string;
  generatedAt: string;
  summary: {
    breaking: number;
    warnings: number;
    info: number;
  };
  findings: Finding[];
  // Paths to visual diff artifacts, keyed by "<locale>_<pageId>"
  visualArtifacts: Record<string, string>;
}

export function buildReport(
  from: string,
  to: string,
  findings: Finding[],
  visualArtifacts: Record<string, string> = {},
): DiffReport {
  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    summary: {
      breaking: findings.filter((f) => f.severity === 'breaking').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    findings,
    visualArtifacts,
  };
}
