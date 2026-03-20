import type { AgentBudget, BudgetConfig, TokenUsage } from './types.js';
import { tokenEstimator } from './token-estimator.js';
import { logger } from '../utils/logger.js';

export class AgentBudgetManager {
  private budgets: Map<string, AgentBudget> = new Map();
  private config: BudgetConfig;
  private globalTokensUsed: number = 0;

  constructor(config: BudgetConfig) {
    this.config = config;
  }

  initializeAgentBudget(agentId: string): void {
    if (this.budgets.has(agentId)) {
      return; // Already initialized
    }

    this.budgets.set(agentId, {
      maxCalls: this.config.perAgentMaxCalls,
      maxTokens: this.config.perAgentMaxTokens,
      currentCalls: 0,
      currentTokens: 0,
    });

    logger.debug(`Initialized budget for agent ${agentId}`);
  }

  canMakeCall(agentId: string, estimatedTokens: number): boolean {
    this.initializeAgentBudget(agentId);

    const budget = this.budgets.get(agentId)!;

    // Check per-agent limits
    if (budget.currentCalls >= budget.maxCalls) {
      logger.warn(`Agent ${agentId} has exceeded max calls (${budget.maxCalls})`);
      return false;
    }

    if (budget.currentTokens + estimatedTokens > budget.maxTokens) {
      logger.warn(
        `Agent ${agentId} would exceed max tokens (${budget.maxTokens}) with estimated ${estimatedTokens} tokens`
      );
      return false;
    }

    // Check global limit
    if (this.globalTokensUsed + estimatedTokens > this.config.globalMaxTokens) {
      logger.warn(
        `Global token limit (${this.config.globalMaxTokens}) would be exceeded with estimated ${estimatedTokens} tokens`
      );
      return false;
    }

    return true;
  }

  recordCall(agentId: string, usage: TokenUsage): void {
    this.initializeAgentBudget(agentId);

    const budget = this.budgets.get(agentId)!;

    budget.currentCalls += 1;
    budget.currentTokens += usage.totalTokens;
    this.globalTokensUsed += usage.totalTokens;

    logger.debug(
      `Agent ${agentId} used ${usage.totalTokens} tokens (call ${budget.currentCalls}/${budget.maxCalls})`
    );
  }

  estimateAndCheck(agentId: string, text: string): { allowed: boolean; estimatedTokens: number } {
    const estimatedTokens = tokenEstimator.estimateTokens(text);
    const allowed = this.canMakeCall(agentId, estimatedTokens);

    return { allowed, estimatedTokens };
  }

  getRemainingBudget(agentId: string): {
    remainingCalls: number;
    remainingTokens: number;
    globalRemainingTokens: number;
  } {
    this.initializeAgentBudget(agentId);

    const budget = this.budgets.get(agentId)!;

    return {
      remainingCalls: Math.max(0, budget.maxCalls - budget.currentCalls),
      remainingTokens: Math.max(0, budget.maxTokens - budget.currentTokens),
      globalRemainingTokens: Math.max(0, this.config.globalMaxTokens - this.globalTokensUsed),
    };
  }

  getAgentBudget(agentId: string): AgentBudget | undefined {
    return this.budgets.get(agentId);
  }

  getAllBudgets(): Map<string, AgentBudget> {
    return new Map(this.budgets);
  }

  resetAgentBudget(agentId: string): void {
    const budget = this.budgets.get(agentId);

    if (!budget) {
      return;
    }

    // Subtract from global before resetting
    this.globalTokensUsed = Math.max(0, this.globalTokensUsed - budget.currentTokens);

    budget.currentCalls = 0;
    budget.currentTokens = 0;

    logger.debug(`Reset budget for agent ${agentId}`);
  }

  resetAllBudgets(): void {
    for (const [agentId] of this.budgets) {
      const budget = this.budgets.get(agentId)!;
      budget.currentCalls = 0;
      budget.currentTokens = 0;
    }

    this.globalTokensUsed = 0;

    logger.debug('Reset all agent budgets');
  }

  getGlobalUsage(): { used: number; limit: number; remaining: number } {
    return {
      used: this.globalTokensUsed,
      limit: this.config.globalMaxTokens,
      remaining: Math.max(0, this.config.globalMaxTokens - this.globalTokensUsed),
    };
  }

  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
    logger.debug('Updated budget configuration');
  }
}

// Default budget configuration.
// These are high-water soft limits used for telemetry and graceful degradation,
// NOT hard execution caps.  Reasoning engine trims context and continues when
// limits are approached rather than stopping the session.
export const defaultBudgetConfig: BudgetConfig = {
  globalMaxTokens:   5_000_000, // 5M tokens — effectively unlimited for normal sessions
  perAgentMaxCalls:        100, // 100 LLM calls per agent before soft warning
  perAgentMaxTokens:   500_000, // 500K tokens per agent
};

// Singleton instance with default config
export const agentBudgetManager = new AgentBudgetManager(defaultBudgetConfig);
