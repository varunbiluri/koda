/**
 * Worker agents — specialized single-responsibility agents.
 *
 * Each agent wraps ReasoningEngine.chat() with a focused system prompt.
 * They are composable: the SupervisorAgent delegates to them based on task type.
 */
export { CodingAgent }   from './coding-agent.js';
export { TestAgent }     from './test-agent.js';
export { RefactorAgent } from './refactor-agent.js';
export { DocsAgent }     from './docs-agent.js';
export { SecurityAgent } from './security-agent.js';

export type { WorkerOptions, WorkerResult } from './coding-agent.js';
