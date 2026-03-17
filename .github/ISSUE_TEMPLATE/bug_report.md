---
name: Bug Report
about: Report a reproducible bug in Koda
title: '[Bug]: '
labels: ['bug', 'triage']
assignees: ''
---

## Describe the bug

A clear and concise description of what the bug is.

## Steps to reproduce

1. Run `koda ...`
2. With this config `...`
3. See error

## Expected behavior

What you expected to happen.

## Actual behavior

What actually happened. Include the full error message/stack trace if available.

## Environment

| Field | Value |
|-------|-------|
| Koda version | `koda --version` |
| Node.js version | `node --version` |
| OS | e.g. macOS 14, Ubuntu 22.04 |
| AI Provider | e.g. Azure OpenAI, OpenAI |

## Configuration (optional)

Paste your `.koda/config.json` with secrets redacted:

```json
{
  "provider": "...",
  "model": "..."
}
```

## Additional context

Any other context about the problem (logs, screenshots, related issues).
