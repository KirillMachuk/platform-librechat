import fs from 'fs';
import path from 'path';
import { logger } from '@librechat/data-schemas';
import type { AgentDefinition } from './definitions';
import { parseAgentDefinition } from './definitions';

/**
 * Reads agent definitions from a directory, mirroring how deployment skills are loaded at
 * boot: an absent directory is simply "nothing to provision" unless an operator pointed at
 * it explicitly, in which case a typo in the path must be loud rather than silently
 * leaving the orchestrator without its researcher.
 */

const DEFAULT_AGENTS_DIR = 'agents.d';

export interface LoadOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadResult {
  directory: string;
  definitions: AgentDefinition[];
  /** Per-file problems, already formatted for a human. */
  errors: string[];
}

function resolveDirectory(options: LoadOptions): { directory: string; explicit: boolean } {
  const env = options.env ?? process.env;
  const projectRoot = options.projectRoot ?? process.cwd();
  const configured = env.AGENT_DEFINITIONS_DIR?.trim();
  const raw = configured != null && configured.length > 0 ? configured : DEFAULT_AGENTS_DIR;
  return {
    directory: path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw),
    explicit: configured != null && configured.length > 0,
  };
}

/**
 * Loads and parses every `.md` file in the directory. Duplicate identities are an error
 * rather than a last-one-wins race: two files claiming the same `name` would otherwise
 * produce a different agent depending on filesystem ordering.
 */
export async function loadAgentDefinitions(options: LoadOptions = {}): Promise<LoadResult> {
  const { directory, explicit } = resolveDirectory(options);

  let entries: string[];
  try {
    entries = await fs.promises.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !explicit) {
      return { directory, definitions: [], errors: [] };
    }
    return {
      directory,
      definitions: [],
      errors: [
        `каталог определений агентов недоступен: ${directory} — ${(error as Error).message}`,
      ],
    };
  }

  const definitions: AgentDefinition[] = [];
  const errors: string[] = [];
  const seen = new Map<string, string>();

  for (const entry of entries.filter((name) => name.endsWith('.md')).sort()) {
    const filePath = path.join(directory, entry);
    const source = await fs.promises.readFile(filePath, 'utf8');
    const { definition, errors: fileErrors } = parseAgentDefinition(source, entry);
    if (!definition) {
      errors.push(...fileErrors);
      continue;
    }
    const duplicate = seen.get(definition.id);
    if (duplicate != null) {
      errors.push(
        `${entry}: имя «${definition.id}» уже занято файлом ${duplicate}. Какой из них ` +
          `окажется применён, зависело бы от порядка чтения каталога.`,
      );
      continue;
    }
    seen.set(definition.id, entry);
    definitions.push(definition);
  }

  logger.debug(
    `[agentDefinitions] ${directory}: файлов ${entries.length}, определений ` +
      `${definitions.length}, ошибок ${errors.length}`,
  );
  return { directory, definitions, errors };
}
