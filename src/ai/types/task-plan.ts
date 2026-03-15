/**
 * Structured task plan produced by the AI planner and executed deterministically
 * by the IterationEngine.
 */

export interface TaskStep {
  /** Name of the tool to call (must match a key in ToolRegistry). */
  tool: string;
  /** Arguments to pass to the tool. */
  args: Record<string, unknown>;
  /** Optional human-readable description shown in CLI output. */
  description?: string;
}

export interface TaskPlan {
  /** High-level description of the overall task. */
  task: string;
  /** Ordered list of tool-call steps to execute. */
  steps: TaskStep[];
}

export interface StepResult {
  step: TaskStep;
  output: string;
  success: boolean;
  error?: string;
}

export interface IterationResult {
  iteration: number;
  plan: TaskPlan;
  stepResults: StepResult[];
  success: boolean;
  failureReason?: string;
}
