import yaml from 'js-yaml';
import { Providers } from '@librechat/agents';

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
 * This module is deliberately pure — parsing and validation only, no database and no
 * filesystem — so the rules can be tested without either.
 */

/** Field required for the record to be usable at all. */
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
  /** Sub-delegation config. `allowSelf` defaults to TRUE upstream, so it is spelled out. */
  subagents?: { enabled?: boolean; allowSelf?: boolean; agent_ids?: string[] };
  model_parameters?: Record<string, unknown>;
  /** Grant every user VIEW access. Required for a shared researcher: without it the
   *  subagent load path fails the permission check and skips delegation silently. */
  shared?: boolean;
}

export interface ParseResult {
  definition?: AgentDefinition;
  /** Human-readable, in Russian — these surface to whoever runs provisioning. */
  errors: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
/** Same shape the platform accepts elsewhere: lowercase, digits, dash, underscore. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function asStringArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim())) {
    errors.push(`${field}: ожидался список строк`);
    return undefined;
  }
  return value.map((v) => (v as string).trim());
}

/**
 * Parses one definition file. Returns every problem at once rather than throwing on the
 * first: someone fixing a file should see the whole list, not peel it one error per run.
 */
export function parseAgentDefinition(source: string, filename = '<inline>'): ParseResult {
  const errors: string[] = [];
  const match = FRONTMATTER.exec(source ?? '');
  if (!match) {
    return {
      errors: [
        `${filename}: нет YAML-шапки. Файл должен начинаться со строки --- и содержать ` +
          `вторую строку --- перед текстом промпта.`,
      ],
    };
  }

  let head: Record<string, unknown>;
  try {
    const parsed = yaml.load(match[1]);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { errors: [`${filename}: шапка должна быть набором «поле: значение»`] };
    }
    head = parsed as Record<string, unknown>;
  } catch (err) {
    return { errors: [`${filename}: шапку не удалось разобрать — ${(err as Error).message}`] };
  }

  const instructions = (match[2] ?? '').trim();
  if (!instructions) {
    errors.push(`${filename}: пустой промпт (текст после второй строки ---)`);
  }

  const id = typeof head.name === 'string' ? head.name.trim() : '';
  if (!id) {
    errors.push(`${filename}: обязательное поле name отсутствует`);
  } else if (!ID_RE.test(id)) {
    errors.push(
      `${filename}: name «${id}» не годится как идентификатор — нужны строчные латинские ` +
        `буквы, цифры, дефис или подчёркивание, от 2 до 63 символов`,
    );
  }

  const description = typeof head.description === 'string' ? head.description.trim() : '';
  if (!description) {
    errors.push(
      `${filename}: обязательное поле description отсутствует. По нему модель-родитель ` +
        `решает, поручать ли задачу этому агенту, — пустое описание означает, что ` +
        `делегирования не будет.`,
    );
  }

  const model = typeof head.model === 'string' ? head.model.trim() : '';
  if (!model) {
    errors.push(`${filename}: обязательное поле model отсутствует`);
  }

  const provider =
    typeof head.provider === 'string' && head.provider.trim()
      ? head.provider.trim()
      : (Providers.OPENAI as string);

  const tools = asStringArray(head.tools, `${filename}: tools`, errors);

  let subagents: AgentDefinition['subagents'];
  if (head.subagents != null) {
    if (typeof head.subagents !== 'object' || Array.isArray(head.subagents)) {
      errors.push(`${filename}: subagents должен быть объектом`);
    } else {
      const raw = head.subagents as Record<string, unknown>;
      const agentIds = asStringArray(raw.agent_ids, `${filename}: subagents.agent_ids`, errors);
      subagents = {
        enabled: raw.enabled !== false,
        /** Upstream default is TRUE. Left implicit, an orchestrator gains a second
         *  delegation target — "spawn a copy of myself" — that carries the PARENT's
         *  prompt instead of the researcher's. Two targets means the model can pick the
         *  prompt-less one, so the field is always written out explicitly. */
        allowSelf: raw.allowSelf === true,
        ...(agentIds ? { agent_ids: agentIds } : {}),
      };
    }
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    definition: {
      id,
      name: typeof head.label === 'string' && head.label.trim() ? head.label.trim() : id,
      description,
      provider,
      model,
      instructions,
      ...(tools ? { tools } : {}),
      ...(subagents ? { subagents } : {}),
      ...(head.model_parameters && typeof head.model_parameters === 'object'
        ? { model_parameters: head.model_parameters as Record<string, unknown> }
        : {}),
      shared: head.shared !== false,
    },
    errors: [],
  };
}

/** Fields the reconciler writes. Anything else on an existing record is left alone, so a
 *  field the platform manages itself (avatar, versions, timestamps) is never clobbered. */
export const MANAGED_FIELDS = [
  'name',
  'description',
  'provider',
  'model',
  'instructions',
  'tools',
  'subagents',
  'model_parameters',
] as const;

/**
 * The write payload for one definition. Splitting this out from the database call is what
 * makes "what would change" testable, and it is also what the dry run prints.
 */
export function toAgentUpdate(def: AgentDefinition): Record<string, unknown> {
  return {
    name: def.name,
    description: def.description,
    provider: def.provider,
    model: def.model,
    instructions: def.instructions,
    tools: def.tools ?? [],
    ...(def.subagents ? { subagents: def.subagents } : {}),
    ...(def.model_parameters ? { model_parameters: def.model_parameters } : {}),
  };
}

/**
 * Which managed fields differ between the file and the stored record. Used to decide
 * whether to write at all (an unchanged file must be a no-op, or every restart would
 * append a version) and to show the operator exactly what a run would change.
 */
export function diffAgent(
  def: AgentDefinition,
  stored: Record<string, unknown> | null | undefined,
): string[] {
  if (!stored) {
    return ['<новый агент>'];
  }
  const next = toAgentUpdate(def);
  const changed: string[] = [];
  for (const field of MANAGED_FIELDS) {
    if (!(field in next)) {
      continue;
    }
    const a = JSON.stringify(next[field] ?? null);
    const b = JSON.stringify(stored[field] ?? null);
    if (a !== b) {
      changed.push(field);
    }
  }
  return changed;
}
