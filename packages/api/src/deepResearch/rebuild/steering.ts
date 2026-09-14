/**
 * Mid-run steering — the clarifications a person types into the ordinary
 * composer WHILE a research run is under way (DR_MIDRUN_STEERING_Plan.md).
 *
 * The run works in rounds: the supervisor fans out a batch of sub-questions,
 * waits, and plans the next batch. A clarification is accepted the moment it
 * arrives and is applied at the START of the next round — nothing already
 * running is thrown away — and the report reads every clarification too, so
 * one that came after the last round still shapes the answer (or is named in
 * it as not researched).
 *
 * One mailbox per run, registered under the job's stream id (= conversation id)
 * for the run's lifetime. It lives in this process, like the job's
 * AbortController: a second replica would not see it, and the steer route then
 * answers with the next step instead of pretending. The mailbox holds the text
 * the GRAPH may read — masked in sovereign mode — next to the saved message the
 * chat shows; the two are never confused.
 */

export interface SteeringMessage {
  messageId: string;
  parentMessageId?: string | null;
  conversationId?: string;
  text?: string;
  [key: string]: unknown;
}

export interface SteeringEntry {
  /** What the graph reads: the clarification, masked when the run is sovereign. */
  text: string;
  /** What the chat shows: the persisted user message (raw text, the user's own). */
  message: SteeringMessage;
  /** ISO timestamp of acceptance. */
  at: string;
}

/** `closed` = the run is over (or unwinding): nothing will read the mailbox again. */
export type SteeringPhase = 'research' | 'report' | 'closed';

export type SteeringRefusal = 'empty' | 'length' | 'limit' | 'report' | 'closed';

/** A clarification longer than this is a new question, not a steer. */
export const MAX_STEER_CHARS = 2000;
/** Bounds the supervisor prompt; ten mid-run notes is already a re-brief. */
export const MAX_STEERS_PER_RUN = 10;

export class SteeringMailbox {
  private readonly list: SteeringEntry[] = [];
  private head: string;
  private readonly initialHead: string;
  private currentPhase: SteeringPhase = 'research';
  private readonly mask?: (text: string) => Promise<string>;

  constructor(options: {
    /** The message the run's answer hangs under when nothing is steered. */
    headMessageId: string;
    /** Sovereign mode: masks a clarification into the run's own placeholder map. */
    mask?: (text: string) => Promise<string>;
  }) {
    this.head = options.headMessageId;
    this.initialHead = options.headMessageId;
    this.mask = options.mask;
  }

  /** The message the run's response must be saved under: the latest steer, else the request. */
  get headMessageId(): string {
    return this.head;
  }

  get phase(): SteeringPhase {
    return this.currentPhase;
  }

  /** The runner flips this once the report node starts (`report`) and when the
   *  run unwinds (`closed`): no node will read a new steer after either. */
  set phase(next: SteeringPhase) {
    this.currentPhase = next;
  }

  get size(): number {
    return this.list.length;
  }

  /** Why a clarification cannot be taken right now, or null when it can. */
  refusal(text: string): SteeringRefusal | null {
    if (!text.trim()) {
      return 'empty';
    }
    if (text.length > MAX_STEER_CHARS) {
      return 'length';
    }
    if (this.currentPhase === 'closed') {
      return 'closed';
    }
    if (this.currentPhase === 'report') {
      return 'report';
    }
    if (this.list.length >= MAX_STEERS_PER_RUN) {
      return 'limit';
    }
    return null;
  }

  /**
   * The text the graph may see. REJECTS when masking fails: raw personal data
   * must never reach a passthrough model call, and the caller then refuses the
   * steer rather than silently dropping it (the chat would show a message the
   * run never read).
   */
  async prepare(text: string): Promise<string> {
    const trimmed = text.trim();
    return this.mask ? this.mask(trimmed) : trimmed;
  }

  /**
   * Records an accepted clarification and moves the branch head onto its message.
   *
   * Synchronous on purpose, and meant to be called in the same tick as the
   * `refusal()` check and the read of `headMessageId` that named the message's
   * parent: with no `await` between them the phase cannot flip and no second
   * clarification can slip in — the two windows the first review found
   * (a steer accepted after the report snapshot; two steers under one head).
   */
  add(entry: { text: string; message: SteeringMessage; at?: string }): SteeringEntry {
    const stored: SteeringEntry = {
      text: entry.text,
      message: entry.message,
      at: entry.at ?? new Date().toISOString(),
    };
    this.list.push(stored);
    this.head = entry.message.messageId;
    return stored;
  }

  /**
   * Takes a clarification back — only the LAST one, whose message failed to
   * persist: an earlier one may already be another entry's parent. Returns
   * whether it was removed; the head goes back to the previous message.
   */
  remove(messageId: string): boolean {
    const last = this.list[this.list.length - 1];
    if (!last || last.message.messageId !== messageId) {
      return false;
    }
    this.list.pop();
    const previous = this.list[this.list.length - 1];
    this.head = previous ? previous.message.messageId : this.initialHead;
    return true;
  }

  /** The clarifications a node reads at its start, oldest first. */
  texts(): string[] {
    return this.list.map((entry) => entry.text);
  }

  /** The persisted messages, oldest first — for the run's final event. */
  messages(): SteeringMessage[] {
    return this.list.map((entry) => entry.message);
  }
}

const registry = new Map<string, SteeringMailbox>();

export function registerSteering(streamId: string, mailbox: SteeringMailbox): void {
  registry.set(streamId, mailbox);
}

export function getSteering(streamId: string): SteeringMailbox | undefined {
  return registry.get(streamId);
}

/** Removes the registration only if it still points at THIS mailbox (a replaced job owns the id now). */
export function unregisterSteering(streamId: string, mailbox: SteeringMailbox): void {
  if (registry.get(streamId) === mailbox) {
    registry.delete(streamId);
  }
}
