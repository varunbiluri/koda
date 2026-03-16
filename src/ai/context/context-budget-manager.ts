/**
 * ContextBudgetManager — enforces a hard token budget on every LLM call.
 *
 * Prevents prompt size explosion by trimming the message list before it is
 * sent to the provider.  The system message is always preserved;
 * user/assistant messages are evicted oldest-first until the estimated
 * token count fits within the available budget.
 */

export interface BudgetMessage {
  role:    string;
  content: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_TOKENS           = 60_000;
const RESERVED_FOR_RESPONSE = 4_000;

// ── ContextBudgetManager ──────────────────────────────────────────────────────

export class ContextBudgetManager {
  private readonly availableTokens: number;

  constructor(
    readonly maxTokens           = MAX_TOKENS,
    readonly reservedForResponse = RESERVED_FOR_RESPONSE,
  ) {
    this.availableTokens = maxTokens - reservedForResponse;
  }

  /**
   * Estimate token count from character count.
   * Rule of thumb: ~4 characters per token for English/code text.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Estimate total tokens across a message list. */
  estimateMessagesTokens(messages: BudgetMessage[]): number {
    return messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : '';
      return sum + this.estimateTokens(content);
    }, 0);
  }

  /**
   * Enforce the token budget on a list of messages.
   *
   * Rules:
   *   1. Always keep every system message.
   *   2. Always keep the most recent non-system message.
   *   3. Evict the oldest non-system messages first until the budget is met.
   *
   * @param messages - Full message list to trim.
   * @returns Trimmed message list that fits within the available token budget.
   */
  enforce<T extends BudgetMessage>(messages: T[]): T[] {
    if (messages.length === 0) return messages;

    const estimated = this.estimateMessagesTokens(messages);
    if (estimated <= this.availableTokens) return messages;

    const systemMsgs    = messages.filter((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    if (nonSystemMsgs.length === 0) return systemMsgs as T[];

    const lastMsg    = nonSystemMsgs[nonSystemMsgs.length - 1];
    const middleMsgs = nonSystemMsgs.slice(0, -1);

    // Calculate the irreducible floor (system + last message)
    const floorTokens =
      this.estimateMessagesTokens(systemMsgs) +
      this.estimateTokens(typeof lastMsg.content === 'string' ? lastMsg.content : '');

    if (floorTokens >= this.availableTokens) {
      // Floor alone fills the budget — return system + last message only
      return [...systemMsgs, lastMsg] as T[];
    }

    // Fill remaining budget with the newest middle messages
    const remaining = this.availableTokens - floorTokens;
    const kept: T[] = [];
    let used = 0;

    for (let i = middleMsgs.length - 1; i >= 0; i--) {
      const msg  = middleMsgs[i];
      const cost = this.estimateTokens(
        typeof msg.content === 'string' ? msg.content : '',
      );
      if (used + cost > remaining) break;
      kept.unshift(msg);
      used += cost;
    }

    return [...systemMsgs, ...kept, lastMsg] as T[];
  }
}

/** Singleton used by ReasoningEngine. */
export const contextBudgetManager = new ContextBudgetManager();
