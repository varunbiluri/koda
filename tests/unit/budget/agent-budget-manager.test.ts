import { describe, it, expect, beforeEach } from 'vitest';
import { AgentBudgetManager, defaultBudgetConfig } from '../../../src/budget/agent-budget-manager.js';
import type { BudgetConfig, TokenUsage } from '../../../src/budget/types.js';

describe('AgentBudgetManager', () => {
  let manager: AgentBudgetManager;
  const testConfig: BudgetConfig = {
    globalMaxTokens: 10000,
    perAgentMaxCalls: 5,
    perAgentMaxTokens: 2000,
  };

  beforeEach(() => {
    manager = new AgentBudgetManager(testConfig);
  });

  describe('initialization', () => {
    it('should initialize agent budget on first access', () => {
      manager.initializeAgentBudget('agent-1');

      const budget = manager.getAgentBudget('agent-1');
      expect(budget).toBeDefined();
      expect(budget?.maxCalls).toBe(5);
      expect(budget?.maxTokens).toBe(2000);
      expect(budget?.currentCalls).toBe(0);
      expect(budget?.currentTokens).toBe(0);
    });

    it('should not reinitialize existing agent budget', () => {
      manager.initializeAgentBudget('agent-1');
      const usage: TokenUsage = { promptTokens: 50, completionTokens: 50, totalTokens: 100 };
      manager.recordCall('agent-1', usage);

      manager.initializeAgentBudget('agent-1');

      const budget = manager.getAgentBudget('agent-1');
      expect(budget?.currentCalls).toBe(1);
      expect(budget?.currentTokens).toBe(100);
    });
  });

  describe('canMakeCall', () => {
    it('should allow call within per-agent limits', () => {
      const canMake = manager.canMakeCall('agent-1', 500);
      expect(canMake).toBe(true);
    });

    it('should block call exceeding per-agent token limit', () => {
      const canMake = manager.canMakeCall('agent-1', 2500);
      expect(canMake).toBe(false);
    });

    it('should block call exceeding per-agent call limit', () => {
      const usage: TokenUsage = { promptTokens: 50, completionTokens: 50, totalTokens: 100 };

      for (let i = 0; i < 5; i++) {
        manager.recordCall('agent-1', usage);
      }

      const canMake = manager.canMakeCall('agent-1', 100);
      expect(canMake).toBe(false);
    });

    it('should block call exceeding global token limit', () => {
      // Use up most of global budget with agent-1
      const usage: TokenUsage = { promptTokens: 4500, completionTokens: 4500, totalTokens: 9000 };
      manager.recordCall('agent-1', usage);

      // agent-2 should be blocked even though it's within its own limits
      const canMake = manager.canMakeCall('agent-2', 2000);
      expect(canMake).toBe(false);
    });

    it('should allow call within global limit', () => {
      const usage: TokenUsage = { promptTokens: 500, completionTokens: 500, totalTokens: 1000 };
      manager.recordCall('agent-1', usage);

      const canMake = manager.canMakeCall('agent-2', 1000);
      expect(canMake).toBe(true);
    });
  });

  describe('recordCall', () => {
    it('should update agent budget after call', () => {
      const usage: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      manager.recordCall('agent-1', usage);

      const budget = manager.getAgentBudget('agent-1');
      expect(budget?.currentCalls).toBe(1);
      expect(budget?.currentTokens).toBe(300);
    });

    it('should update global tokens used', () => {
      const usage1: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      const usage2: TokenUsage = { promptTokens: 150, completionTokens: 250, totalTokens: 400 };

      manager.recordCall('agent-1', usage1);
      manager.recordCall('agent-2', usage2);

      const global = manager.getGlobalUsage();
      expect(global.used).toBe(700);
    });
  });

  describe('estimateAndCheck', () => {
    it('should estimate tokens and check if allowed', () => {
      const text = 'This is a test message that should be estimated';
      const result = manager.estimateAndCheck('agent-1', text);

      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.allowed).toBe(true);
    });

    it('should return false if estimate would exceed limit', () => {
      const longText = 'a'.repeat(10000); // ~2500 tokens
      const result = manager.estimateAndCheck('agent-1', longText);

      expect(result.estimatedTokens).toBeGreaterThan(2000);
      expect(result.allowed).toBe(false);
    });
  });

  describe('getRemainingBudget', () => {
    it('should return correct remaining budget', () => {
      const usage: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      manager.recordCall('agent-1', usage);
      manager.recordCall('agent-1', usage);

      const remaining = manager.getRemainingBudget('agent-1');

      expect(remaining.remainingCalls).toBe(3); // 5 - 2
      expect(remaining.remainingTokens).toBe(1400); // 2000 - 600
      expect(remaining.globalRemainingTokens).toBe(9400); // 10000 - 600
    });

    it('should not return negative values', () => {
      const usage: TokenUsage = { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 };

      for (let i = 0; i < 5; i++) {
        manager.recordCall('agent-1', usage);
      }

      const remaining = manager.getRemainingBudget('agent-1');

      expect(remaining.remainingCalls).toBe(0);
      expect(remaining.remainingTokens).toBe(0);
      expect(remaining.globalRemainingTokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetAgentBudget', () => {
    it('should reset individual agent budget', () => {
      const usage: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      manager.recordCall('agent-1', usage);
      manager.recordCall('agent-2', usage);

      manager.resetAgentBudget('agent-1');

      const budget1 = manager.getAgentBudget('agent-1');
      const budget2 = manager.getAgentBudget('agent-2');

      expect(budget1?.currentCalls).toBe(0);
      expect(budget1?.currentTokens).toBe(0);
      expect(budget2?.currentCalls).toBe(1);
      expect(budget2?.currentTokens).toBe(300);
    });

    it('should adjust global tokens when resetting', () => {
      const usage: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      manager.recordCall('agent-1', usage);
      manager.recordCall('agent-2', usage);

      expect(manager.getGlobalUsage().used).toBe(600);

      manager.resetAgentBudget('agent-1');

      expect(manager.getGlobalUsage().used).toBe(300);
    });
  });

  describe('resetAllBudgets', () => {
    it('should reset all agent budgets', () => {
      const usage: TokenUsage = { promptTokens: 100, completionTokens: 200, totalTokens: 300 };
      manager.recordCall('agent-1', usage);
      manager.recordCall('agent-2', usage);

      manager.resetAllBudgets();

      const budget1 = manager.getAgentBudget('agent-1');
      const budget2 = manager.getAgentBudget('agent-2');

      expect(budget1?.currentCalls).toBe(0);
      expect(budget1?.currentTokens).toBe(0);
      expect(budget2?.currentCalls).toBe(0);
      expect(budget2?.currentTokens).toBe(0);
      expect(manager.getGlobalUsage().used).toBe(0);
    });
  });

  describe('updateConfig', () => {
    it('should update budget configuration', () => {
      manager.updateConfig({ globalMaxTokens: 20000 });

      const global = manager.getGlobalUsage();
      expect(global.limit).toBe(20000);
    });

    it('should partially update configuration', () => {
      manager.updateConfig({ perAgentMaxCalls: 10 });

      manager.initializeAgentBudget('agent-new');
      const budget = manager.getAgentBudget('agent-new');

      expect(budget?.maxCalls).toBe(10);
      expect(budget?.maxTokens).toBe(2000); // Unchanged
    });
  });

  describe('getAllBudgets', () => {
    it('should return all agent budgets', () => {
      manager.initializeAgentBudget('agent-1');
      manager.initializeAgentBudget('agent-2');

      const allBudgets = manager.getAllBudgets();

      expect(allBudgets.size).toBe(2);
      expect(allBudgets.has('agent-1')).toBe(true);
      expect(allBudgets.has('agent-2')).toBe(true);
    });
  });

  describe('defaultBudgetConfig', () => {
    it('should have reasonable defaults', () => {
      expect(defaultBudgetConfig.globalMaxTokens).toBeGreaterThan(0);
      expect(defaultBudgetConfig.perAgentMaxCalls).toBeGreaterThan(0);
      expect(defaultBudgetConfig.perAgentMaxTokens).toBeGreaterThan(0);
    });
  });
});
