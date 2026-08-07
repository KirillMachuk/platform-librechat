import yaml from 'js-yaml';
import { Providers } from '@librechat/agents';
import type { AgentSubagentsConfig, AgentModelParameters } from 'librechat-data-provider';

/**
 * Agent definitions as FILES, reconciled into the database.
 *
 * An orchestrator that delegates to a researcher needs that researcher to exist as an
 * agent record, because `subagents.agent_ids` is resolved through the database. Creating
 * that record by hand in the admin UI is the failure mode this module exists to avoid:
 * it is invisible to review, absent from any environment nobody clicked through, and
 * silently gone whenever the stand is rebuilt. Worse, a missing or unreadable subagent is
 * skipped WITHOUT an error — the orchestrator simply stops delegating and still looks
 * healthy.
 *
 * So the definition lives in a file, in git, and the database is a projection of it. The
 * format is YAML frontmatter plus a Markdown body, matching the convention Claude Code
 * uses for its own subagents: the body IS the system prompt, so the prompt stays readable
 * and diffable instead of being escaped into a config string.
 *
 * Parsing and validation only — no database and no filesystem — so the rules are testable
 * without either.
 */

/** Frontmatter as authored. Every field is optional here; validation is what makes an
 *  `AgentDefinition` out of it, reporting each missing piece by name. */
interface Frontmatter {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  provider?: unknown;
  model?: unknown;
  tools?: unknown;
  subagents?: unknown;
  model_parameters?: unknown;
  shared?: unknown;
}

export interface AgentDefinition {
  /** Stable identity. Comes from `name` in the frontmatter, never from the filename. */
  id: string;
  /** Human-facing name shown wherever the agent appears. */
  name: string;
  /** What the agent is for. The parent model reads this to decide whether to delegate. */
  description: string;
  provider: string;
  model: string;
  /** The Markdown body: the agent's system prompt, verbatim. */
  instructions: string;
  /** Tool names the agent may call. Absent means "no tools". */
  tools?: string[];
  subagents?: AgentSubagentsConfig;
  model_parameters?: Partial<AgentModelParameters>;
  /** Grant every user VIEW access. Required for a shared researcher: without it the
   *  subagent load path fails the permission check and skips delegation silently. */
  shared: boolean;
}

/** What the reconciler writes. Anything absent here is left untouched on an existing
 *  record, so platform-managed fields (avatar, versions, timestamps) are never clobbered. */
export interface AgentUpdate {
  name: string;
  description: string;
  provider: string;
  model: string;
  instructions: string;
  tools: string[];
  subagents?: AgentSubagentsConfig;
  model_parameters?: Partial<AgentModelParameters>;
}

export interface ParseResult {
  definition?: AgentDefinition;
  /** Human-readable, in Russian — these surface to whoever runs provisioning. */
  errors: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
/** Same shape the platform accepts elsewhere: lowercase, digits, dash, underscore. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const MANAGED_FIELDS: ReadonlyArray<keyof AgentUpdate> = [
  'name',
  'description',
  'provider',
  'model',
  'instructions',
  'tools',
  'subagents',
  'model_parameters',
];

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => trimmedString(entry) === '')) {
    errors.push(`${field}: ожидался список непустых строк`);
    return undefined;
  }
  return value.map((entry) => trimmedString(entry));
}

function parseSubagents(
  value: unknown,
  filename: string,
  errors: string[],
): AgentSubagentsConfig | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push(`${filename}: subagents должен быть объектом`);
    return undefined;
  }
  const agentIds = asStringArray(value.agent_ids, `${filename}: subagents.agent_ids`, errors);
  return {
    enabled: value.enabled !== false,
    /** Upstream default is TRUE. Left implicit, an orchestrator gains a second delegation
     *  target — "spawn a copy of myself" — carrying the PARENT's prompt instead of the
     *  researcher's, and the model can pick the prompt-less one. Always written out. */
    allowSelf: value.allowSelf === true,
    ...(agentIds ? { agent_ids: agentIds } : {}),
  };
}

/**
 * Parses one definition file. Returns every problem at once rather than throwing on the
 * first: someone fixing a file should see the whole list, not peel it one error per run.
 */
export function parseAgentDefinition(source: string, filename = '<inline>'): ParseResult {
  const match = FRONTMATTER.exec(source ?? '');
  if (!match) {
    return {
      errors: [
        `${filename}: нет YAML-шапки. Файл должен начинаться со строки --- и содержать ` +
          `вторую строку --- перед текстом промпта.`,
      ],
    };
  }

  let head: Frontmatter;
  try {
    const parsed: unknown = yaml.load(match[1]);
    if (!isPlainObject(parsed)) {
      return { errors: [`${filename}: шапка должна быть набором «поле: значение»`] };
    }
    head = parsed as Frontmatter;
  } catch (error) {
    return { errors: [`${filename}: шапку не удалось разобрать — ${(error as Error).message}`] };
  }

  const errors: string[] = [];
  const instructions = (match[2] ?? '').trim();
  if (!instructions) {
    errors.push(`${filename}: пустой промпт (текст после второй строки ---)`);
  }

  const id = trimmedString(head.name);
  if (!id) {
    errors.push(`${filename}: обязательное поле name отсутствует`);
  } else if (!ID_RE.test(id)) {
    errors.push(
      `${filename}: name «${id}» не годится как идентификатор — нужны строчные латинские ` +
        `буквы, цифры, дефис или подчёркивание, до 63 символов`,
    );
  }

  const description = trimmedString(head.description);
  if (!description) {
    errors.push(
      `${filename}: обязательное поле description отсутствует. По нему модель-родитель ` +
        `решает, поручать ли задачу этому агенту, — пустое описание означает, что ` +
        `делегирования не будет.`,
    );
  }

  const model = trimmedString(head.model);
  if (!model) {
    errors.push(`${filename}: обязательное поле model отсутствует`);
  }

  const tools = asStringArray(head.tools, `${filename}: tools`, errors);
  const subagents = parseSubagents(head.subagents, filename, errors);

  if (errors.length > 0) {
    return { errors };
  }

  return {
    definition: {
      id,
      name: trimmedString(head.label) || id,
      description,
      provider: trimmedString(head.provider) || (Providers.OPENAI as string),
      model,
      instructions,
      ...(tools ? { tools } : {}),
      ...(subagents ? { subagents } : {}),
      ...(isPlainObject(head.model_parameters)
        ? { model_parameters: head.model_parameters as Partial<AgentModelParameters> }
        : {}),
      shared: head.shared !== false,
    },
    errors: [],
  };
}

/**
 * The write payload for one definition. Kept separate from the database call so that
 * "what would change" is testable, and so the dry run has something exact to print.
 */
export function toAgentUpdate(definition: AgentDefinition): AgentUpdate {
  return {
    name: definition.name,
    description: definition.description,
    provider: definition.provider,
    model: definition.model,
    instructions: definition.instructions,
    tools: definition.tools ?? [],
    ...(definition.subagents ? { subagents: definition.subagents } : {}),
    ...(definition.model_parameters ? { model_parameters: definition.model_parameters } : {}),
  };
}

/**
 * Which managed fields differ between the file and the stored record. Used to decide
 * whether to write at all — an unchanged file must be a no-op, or every restart would
 * append a new agent version — and to show exactly what a run would change.
 */
export function diffAgent(
  definition: AgentDefinition,
  stored: Partial<AgentUpdate> | null | undefined,
): string[] {
  if (!stored) {
    return ['<новый агент>'];
  }
  const next = toAgentUpdate(definition);
  return MANAGED_FIELDS.filter(
    (field) =>
      field in next &&
      JSON.stringify(next[field] ?? null) !== JSON.stringify(stored[field] ?? null),
  );
}
