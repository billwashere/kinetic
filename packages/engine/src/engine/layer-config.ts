import { resolvePath } from './workspace-config';
import path from 'path';
import fs from 'fs-extra';
import { LayerConfigSchema, type LayerConfig } from './layer-config-schema';

export * from './layer-config-schema';

/**
 * Loads and validates layer-config.json from the engine package root.
 * Returns defaults if the file doesn't exist — music and watermark are absent,
 * subtitle style uses defaults.
 */
export async function loadLayerConfig(): Promise<LayerConfig> {
  const configPath = resolvePath('layerConfig', path.join(process.cwd(), 'layer-config.json'));

  if (!(await fs.pathExists(configPath))) {
    return LayerConfigSchema.parse({});
  }

  const raw = await fs.readJson(configPath);
  const result = LayerConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(
      `Invalid layer-config.json:\n${issues}\n\nSee layer-config.example.json for reference.`,
    );
  }

  return result.data;
}
