# Koda Phase 2: AI Reasoning Integration

Phase 2 extends Koda with AI-powered code analysis using Azure AI Foundry.

## What's New

**AI-Powered Analysis** — Instead of just returning search results, Koda now:
1. Searches the repository using TF-IDF vector search
2. Builds context from top matching code chunks
3. Sends context to Azure AI Foundry models
4. Returns structured explanations with file references

## Setup

### 1. Configure AI Credentials

```bash
koda login
```

You'll be prompted for:
- Azure AI Foundry Endpoint
- Azure API Key
- Default Model (e.g., gpt-4)

Credentials are saved to `~/.koda/config.json`

### 2. List Available Models

```bash
koda models
```

This fetches deployments from your Azure AI Foundry instance.

### 3. Switch Models

```bash
koda use gpt-4
```

## Usage

### AI-Powered Analysis

```bash
koda ask "How does authentication work?"
```

**Behavior:**
- If AI credentials are configured → streams AI analysis
- If not configured → falls back to search-only mode

**Disable AI for a single query:**

```bash
koda ask "some query" --no-ai
```

### Example Output

```
Analyzing repository...

How does authentication work?

Authentication is implemented in:

1. src/auth/service.ts
2. src/auth/middleware.ts

The `loginUser` function validates JWT tokens before allowing access.
It follows these steps:

1. Extract token from request headers (auth/middleware.ts:15-20)
2. Verify token signature using JWT library (auth/service.ts:42-48)
3. Decode user claims and attach to request context (auth/service.ts:50-55)

The system uses RS256 algorithm for token signing...

────────────────────────────────────────────────────────────
Files analyzed: 2
Code chunks: 5
```

## Architecture

### New Modules

```
src/ai/
├── types.ts                    # AI provider interfaces
├── config-store.ts             # Credential management
├── providers/
│   └── azure-provider.ts       # Azure AI Foundry integration
├── prompts/
│   ├── system-prompt.ts        # System prompt for Koda
│   └── code-analysis.ts        # Code analysis template
└── reasoning/
    └── reasoning-engine.ts     # Orchestrates search → AI → response

src/context/
└── context-builder.ts          # Converts search results to prompts

src/cli/commands/
├── login.ts                    # Configure credentials
├── models.ts                   # List models
└── use.ts                      # Switch models
```

### Flow

```
User Query
    ↓
QueryEngine (Phase 1 TF-IDF search)
    ↓
Top code chunks
    ↓
ContextBuilder (format with token limit)
    ↓
ReasoningEngine
    ├── System prompt
    ├── Code context
    └── User query
    ↓
Azure AI Foundry (streaming)
    ↓
Formatted response
```

## API Integration

### Azure AI Foundry Endpoints

**Chat Completions:**
```
POST {endpoint}/openai/deployments/{model}/chat/completions?api-version=2024-05-01-preview
```

**List Deployments:**
```
GET {endpoint}/openai/deployments?api-version=2024-05-01-preview
```

### Streaming

Koda uses Server-Sent Events (SSE) for streaming responses from Azure AI Foundry, providing real-time output as the model generates text.

## Token Management

- **Context Limit**: 8,000 tokens (configurable)
- **Response Limit**: 2,000 tokens max
- **Estimation**: ~4 characters per token

Context builder automatically truncates when limits are exceeded.

## Error Handling

Koda gracefully handles:
- Missing AI configuration → fallback to search-only
- Azure API errors → fallback to search-only
- Empty search results → clear error message
- Context too large → automatic truncation

## Testing

Phase 2 includes comprehensive tests:
- Azure provider mock tests
- Context builder tests
- Prompt formatting tests
- Reasoning engine orchestration tests

Run tests:
```bash
pnpm test
```

## Backward Compatibility

Phase 2 is **fully backward compatible** with Phase 1:
- All Phase 1 commands still work
- Search-only mode available with `--no-ai`
- No AI configuration required for basic indexing/search

## Security

- Credentials stored in `~/.koda/config.json` (user home directory)
- API keys never logged or displayed
- No telemetry or data sharing

## Future Enhancements (Phase 3+)

Potential improvements:
- Support for other AI providers (OpenAI, Anthropic)
- Code generation capabilities
- Interactive follow-up questions
- Multi-turn conversations
- Larger context windows
- Fine-tuned models for code analysis
