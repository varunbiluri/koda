export interface ExecutionRecord {
  id: string;
  timestamp: Date;
  task: string;
  success: boolean;
  agentsUsed: string[];
  filesModified: string[];
  errors: string[];
  warnings: string[];
  verificationAttempts: number;
  totalTokensUsed: number;
  duration: number;  // milliseconds
  solutions?: string[];  // Successful fixes applied
}

export interface ExecutionPattern {
  taskType: string;
  successfulAgents: string[];
  commonErrors: string[];
  averageAttempts: number;
  successRate: number;
}

export interface LearningInsight {
  pattern: string;
  recommendation: string;
  confidence: number;
  occurrences: number;
}
