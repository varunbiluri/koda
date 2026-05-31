# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

To report a security vulnerability, use one of the following methods:

1. **GitHub Security Advisories (preferred):** [Open a private advisory](https://github.com/varunbiluri/koda/security/advisories/new)
2. **Email:** Contact the maintainer directly (see GitHub profile)

Please include as much of the following information as possible to help us understand and address the issue quickly:

- Type of vulnerability (e.g. prompt injection, path traversal, credential leak)
- The component affected (CLI command, AI provider, tool executor, etc.)
- Step-by-step reproduction instructions
- Proof-of-concept code or example (if available)
- Potential impact

## Response Timeline

| Stage | Target |
|-------|--------|
| Initial acknowledgment | 48 hours |
| Triage and severity assessment | 5 business days |
| Fix and coordinated disclosure | 30 days (critical: 7 days) |

## Security Considerations

Koda executes LLM-generated code and shell commands against your local repository. Key security boundaries:

- **AI Provider keys** are stored in `.koda/config.json` — ensure this file is not committed to version control (it is in `.gitignore` by default)
- **Tool execution** runs with the same permissions as the current user — do not run Koda as root
- **Prompt injection** in repository files could influence agent behavior — only run Koda on repositories you trust
- **Network access** is limited to your configured AI provider endpoint

## Scope

In-scope vulnerabilities include:
- Arbitrary code execution via prompt injection or malformed tool results
- Credential leakage (API keys, tokens)
- Path traversal outside the target repository
- Privilege escalation

Out of scope:
- Issues requiring physical access to the machine
- Social engineering attacks
- Vulnerabilities in third-party AI providers or their APIs
