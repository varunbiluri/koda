# Example: Custom Agent

Implement a custom agent and register it with the Koda supervisor.

## Prerequisites

- Koda installed and configured
- Familiarity with TypeScript

## Overview

Koda's agent system is built around a common `Agent` interface. Any class that implements `execute()` can be registered as a worker agent and dispatched by the `SupervisorAgent`.

## Step 1 — Implement the agent

Create `src/agents/workers/my-custom-agent.ts`:

```typescript
import type { AgentInput, AgentOutput } from '../types.js';
import { logger } from '../../utils/logger.js';

/**
 * MyCustomAgent — example custom agent that counts TODO comments.
 */
export class MyCustomAgent {
  readonly role = 'MyCustomAgent';

  async execute(input: AgentInput): Promise<AgentOutput> {
    logger.info(`[MyCustomAgent] processing: ${input.task}`);

    // Your agent logic here — use the tools provided in input.tools
    const result = await input.tools.grep_code({
      pattern: 'TODO',
      directory: input.rootPath,
    });

    const todoCount = (result.output.match(/^.+$/gm) ?? []).length;

    return {
      output: `Found ${todoCount} TODO comment(s) in the codebase.`,
      filesModified: [],
      toolCallCount: 1,
    };
  }
}
```

## Step 2 — Register with the supervisor

In `src/agents/supervisor-agent.ts`, add your agent to the worker map:

```typescript
import { MyCustomAgent } from './workers/my-custom-agent.js';

// Inside SupervisorAgent constructor or factory:
this.workers.set('MyCustomAgent', new MyCustomAgent());
```

## Step 3 — Use it in a task graph

Reference your agent by role name in a `TaskGraphBuilder` plan or via `buildFromNodes()`:

```typescript
import { TaskGraphBuilder } from './src/planning/task-graph-builder.js';

const builder = new TaskGraphBuilder(provider);
const graph = builder.buildFromNodes('Count TODOs', [
  {
    id: 'count_todos',
    type: 'analyze',
    agentRole: 'MyCustomAgent',   // <-- your custom role
    description: 'Count all TODO comments',
    dependsOn: [],
    state: 'pending',
    context: { task: 'Count all TODO comments' },
    retryCount: 0,
    maxRetries: 1,
    priority: 5,
  },
]);

const scheduler = new GraphScheduler(provider, null, chatContext, toolResultIndex);
const result = await scheduler.run(graph);
console.log('Completed:', result.completed);
```

## Tips

- Agent roles are strings — they must match exactly between the graph node and the worker map
- Agents can use any tool available in `AgentInput.tools`
- Return `filesModified` to let the scheduler track what changed
- Use `logger.debug` / `logger.info` for visibility in verbose mode
