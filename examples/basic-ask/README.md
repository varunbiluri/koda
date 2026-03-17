# Example: Basic Ask

Ask Koda a natural-language question about your codebase.

## Prerequisites

- Koda installed (`npm install -g @varunbilluri/koda`)
- AI provider configured (`koda login`)
- Repository indexed (`koda init`)

## Usage

```bash
# Index the repository first (run once)
koda init

# Ask questions about the codebase
koda ask "Where is the authentication logic?"
koda ask "How does the retry mechanism work?"
koda ask "What does the GraphScheduler do?"
koda ask "Which files handle database connections?"
```

## Example output

```
$ koda ask "Where is the authentication logic?"

Searching codebase for authentication...

The authentication logic is spread across three areas:

1. **src/auth/jwt.ts** — JWT token creation and verification
   - `createToken(userId, role)` — signs a JWT with 24h expiry
   - `verifyToken(token)` — validates signature and expiry

2. **src/middleware/auth.ts** — Express middleware
   - `requireAuth` — rejects requests without a valid Bearer token
   - `optionalAuth` — attaches user context when token is present

3. **src/cli/login.ts** — AI provider credential storage
   - Stores API keys in `.koda/config.json`
   - Uses `koda login` to configure interactively

Related: src/types/user.ts, src/routes/auth.ts
```

## Tips

- Be specific: `"How does retryCount work in ExecutionGraph?"` gives better results than `"How does retry work?"`
- Ask about relationships: `"What calls GraphScheduler.run()?"`
- Ask about patterns: `"Show me all places where we mock vi.fn()"`
