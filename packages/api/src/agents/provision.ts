import { logger } from '@librechat/data-schemas';
import { toAgentUpdate, diffAgent } from './definitions';
import type { AgentDefinition, AgentUpdate } from './definitions';

/**
 * Reconciles file-defined agents into the database.
 *
 * The file is the source of truth and the record is its projection, so a rebuilt stand
 * restores itself and a prompt change arrives as a reviewable diff instead of someone
 * remembering to click through an admin form. Reconciliation runs on every boot and must
 * therefore be a no-op when nothing changed — `diffAgent` is what makes that true, since
 * writing unconditionally would append a fresh agent version on each restart.
 *
 * Drift (someone edited the agent in the UI) is resolved in favour of the file, but never
 * silently: the overwritten fields are logged by name, and the platform's own agent
 * versioning keeps the previous state recoverable through `revertAgentVersion`.
 */

export interface StoredAgent extends Partial<AgentUpdate> {
  id: string;
  /** Mongo `_id`; permissions are granted against this, not the human-readable id. */
  _id: unknown;
}

/** What creation writes: the managed fields plus the two the schema requires of us. */
export interface NewAgent extends AgentUpdate {
  id: string;
  author: string;
}

export interface ProvisionDeps {
  getAgent: (search: { id: string }) => Promise<StoredAgent | null>;
  createAgent: (data: NewAgent) => Promise<StoredAgent>;
  updateAgent: (search: { id: string }, data: AgentUpdate) => Promise<StoredAgent>;
  /** Grants every user VIEW access. Without it the subagent loader fails its permission
   *  check and skips delegation with only a warn line — the orchestrator keeps looking
   *  healthy while never delegating, which is the worst possible failure shape. */
  grantPublicView: (resourceId: unknown, grantedBy: string) => Promise<void>;
  /** Owner of provisioned agents. `author` is required by the schema and refs a User. */
  authorId: string;
}

export type ProvisionAction = 'created' | 'updated' | 'unchanged' | 'failed';

export interface ProvisionOutcome {
  id: string;
  action: ProvisionAction;
  /** Managed fields that differed; empty for `unchanged`. */
  changed: string[];
  error?: string;
}

export interface ProvisionOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

async function provisionOne(
  definition: AgentDefinition,
  deps: ProvisionDeps,
  options: ProvisionOptions,
): Promise<ProvisionOutcome> {
  const stored = await deps.getAgent({ id: definition.id });
  const changed = diffAgent(definition, stored);

  if (stored && changed.length === 0) {
    return { id: definition.id, action: 'unchanged', changed: [] };
  }

  if (options.dryRun === true) {
    return { id: definition.id, action: stored ? 'updated' : 'created', changed };
  }

  const update = toAgentUpdate(definition);

  if (!stored) {
    /** `updateAgent` runs with `upsert: false`, so creation is a genuinely separate path
     *  rather than an option on the update. */
    const created = await deps.createAgent({
      ...update,
      id: definition.id,
      author: deps.authorId,
    });
    if (definition.shared) {
      await deps.grantPublicView(created._id, deps.authorId);
    }
    return { id: definition.id, action: 'created', changed: ['<новый агент>'] };
  }

  logger.info(
    `[provisionAgents] «${definition.id}»: файл перекрывает запись в базе, поля — ` +
      `${changed.join(', ')}. Прежнее состояние осталось версией агента.`,
  );
  await deps.updateAgent({ id: definition.id }, update);
  if (definition.shared) {
    await deps.grantPublicView(stored._id, deps.authorId);
  }
  return { id: definition.id, action: 'updated', changed };
}

/**
 * Applies every definition. One failing agent does not abort the rest: a typo in a new
 * definition must not take down an orchestrator whose researcher is already provisioned.
 * The caller decides what a partial result means by reading the outcomes.
 */
export async function provisionAgents(
  definitions: AgentDefinition[],
  deps: ProvisionDeps,
  options: ProvisionOptions = {},
): Promise<ProvisionOutcome[]> {
  const outcomes: ProvisionOutcome[] = [];
  for (const definition of definitions) {
    try {
      outcomes.push(await provisionOne(definition, deps, options));
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`[provisionAgents] «${definition.id}» не применён: ${message}`);
      outcomes.push({ id: definition.id, action: 'failed', changed: [], error: message });
    }
  }
  return outcomes;
}

/** One-line summary for the boot log and for the CLI. */
export function summarise(outcomes: ProvisionOutcome[]): string {
  const count = (action: ProvisionAction): number =>
    outcomes.filter((outcome) => outcome.action === action).length;
  return (
    `создано ${count('created')}, обновлено ${count('updated')}, ` +
    `без изменений ${count('unchanged')}, ошибок ${count('failed')}`
  );
}
