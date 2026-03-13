export interface AgentBudget {
  maxCalls: number;
  maxTokens: number;
  currentCalls: number;
  currentTokens: number;
}

export interface BudgetConfig {
  globalMaxTokens: number;
  perAgentMaxCalls: number;
  perAgentMaxTokens: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
