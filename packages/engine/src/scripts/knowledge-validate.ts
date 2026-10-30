import dotenv from 'dotenv';
import { buildKnowledge } from '../knowledge/source';
import { formatDiagnostic, hasErrors } from '../knowledge/model';

dotenv.config();

async function main(): Promise<void> {
  const strict = process.argv.includes('--strict');
  const { diagnostics, validation } = await buildKnowledge();
  for (const d of diagnostics) console.log(formatDiagnostic(d));

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const { nodes, edges } = validation.graph;
  console.log(
    `\n${hasErrors(diagnostics) ? '❌' : '✅'} ${nodes.length} nodes (${nodes.filter((n) => n.origin === 'authored').length} authored), ` +
      `${edges.length} edges — ${errors} error(s), ${warnings} warning(s)`,
  );
  if (hasErrors(diagnostics) || (strict && warnings > 0)) process.exit(1);
}

main().catch((err) => {
  console.error('❌ knowledge-validate failed:', err);
  process.exit(1);
});
