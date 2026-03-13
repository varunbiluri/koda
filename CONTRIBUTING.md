# Contributing to Koda

First off, thank you for considering contributing to Koda! 🎉

Koda is an open-source AI software engineer, and we welcome contributions from the community. Whether it's bug reports, feature requests, documentation improvements, or code contributions, we appreciate your help!

---

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Contribution Workflow](#contribution-workflow)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Review Process](#review-process)

---

## 📜 Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

---

## 🤝 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When submitting a bug report, include:**
- Clear, descriptive title
- Exact steps to reproduce
- Expected vs actual behavior
- Code samples, error messages, logs
- Environment (OS, Node.js version, etc.)
- Screenshots if applicable

**Use this template:**
```markdown
**Description:** Brief description of the bug

**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected Behavior:** What should happen

**Actual Behavior:** What actually happens

**Environment:**
- OS: [e.g., macOS 14.0]
- Node.js: [e.g., v20.0.0]
- Koda version: [e.g., 0.1.0]

**Additional Context:** Any other relevant information
```

### Suggesting Features

We love feature suggestions! Please:
- Check if the feature has already been requested
- Provide clear use cases
- Explain why this feature would be useful
- Consider implementation approaches

### Improving Documentation

Documentation improvements are always welcome:
- Fix typos or unclear explanations
- Add examples or tutorials
- Improve API documentation
- Translate documentation

### Contributing Code

See the sections below for code contribution guidelines.

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js** 18.0.0 or higher
- **pnpm** 8.0.0 or higher
- **Git** for version control

### Initial Setup

1. **Fork the repository** on GitHub

2. **Clone your fork:**
```bash
git clone https://github.com/YOUR_USERNAME/koda.git
cd koda
```

3. **Add upstream remote:**
```bash
git remote add upstream https://github.com/ORIGINAL_OWNER/koda.git
```

4. **Install dependencies:**
```bash
pnpm install
```

5. **Build the project:**
```bash
pnpm build
```

6. **Run tests:**
```bash
pnpm test
```

7. **Link for local testing:**
```bash
pnpm link --global
```

### Development Commands

```bash
# Run in dev mode (without build)
pnpm dev <command>

# Build TypeScript
pnpm build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type checking
pnpm type-check

# Linting
pnpm lint
```

---

## 🔄 Contribution Workflow

### 1. Create a Branch

Always create a new branch for your work:

```bash
# Update your fork
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b fix/bug-description
```

**Branch naming conventions:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test additions/changes
- `chore/` - Build process, dependencies, etc.

### 2. Make Your Changes

- Write clean, readable code
- Follow existing code style
- Add/update tests as needed
- Update documentation
- Keep commits focused and atomic

### 3. Test Your Changes

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test path/to/test.ts

# Run type checking
pnpm build

# Test the CLI
pnpm dev init
pnpm dev ask "test query"
```

### 4. Commit Your Changes

Follow our [commit message guidelines](#commit-message-guidelines):

```bash
git add .
git commit -m "feat: add new agent for code review"
```

### 5. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 6. Create a Pull Request

1. Go to the original repository on GitHub
2. Click "New Pull Request"
3. Select your fork and branch
4. Fill out the PR template
5. Submit the PR

---

## 💻 Coding Standards

### TypeScript Guidelines

- **Use TypeScript** for all new code
- **Strict typing** - avoid `any`, use proper types
- **Interfaces** for public APIs
- **Async/await** instead of callbacks
- **ESM imports** - use `.js` extension in imports

**Example:**
```typescript
// Good ✅
import type { Agent, AgentInput, AgentOutput } from '../types.js';

export class MyAgent implements Agent {
  async execute(input: AgentInput): Promise<AgentOutput> {
    // Implementation
  }
}

// Bad ❌
const something: any = {};
import { Agent } from '../types'; // Missing .js
```

### Code Style

- **Indentation:** 2 spaces
- **Quotes:** Single quotes for strings
- **Semicolons:** Yes, always
- **Line length:** Max 100 characters
- **Naming:**
  - `camelCase` for variables and functions
  - `PascalCase` for classes and types
  - `UPPER_CASE` for constants

### File Organization

```typescript
// 1. Imports (external, then internal)
import { readFile } from 'fs/promises';
import { Agent } from '../types.js';

// 2. Types/Interfaces
export interface MyType {
  // ...
}

// 3. Constants
const DEFAULT_VALUE = 100;

// 4. Main class/function
export class MyClass {
  // ...
}

// 5. Helper functions (private)
function helperFunction() {
  // ...
}
```

### Testing

- **Test all new features** - minimum coverage
- **Unit tests** for individual components
- **Integration tests** for workflows
- **Use descriptive test names**

```typescript
describe('MyAgent', () => {
  it('should successfully process valid input', async () => {
    // Test implementation
  });

  it('should handle errors gracefully', async () => {
    // Test implementation
  });
});
```

---

## 📝 Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, no logic change)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Build process, dependencies, tools

### Scope (optional)

- `agents` - Agent system changes
- `cli` - CLI commands
- `engine` - Indexing engine
- `ai` - AI integration
- `docs` - Documentation

### Examples

```bash
# Good commit messages ✅
git commit -m "feat(agents): add code review agent"
git commit -m "fix(cli): resolve init command crash on empty directory"
git commit -m "docs: update installation instructions for Windows"
git commit -m "test(engine): add tests for AST parser"

# Bad commit messages ❌
git commit -m "fixed stuff"
git commit -m "WIP"
git commit -m "asdf"
```

---

## 🔍 Pull Request Process

### Before Submitting

- [ ] Code builds without errors (`pnpm build`)
- [ ] All tests pass (`pnpm test`)
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] Commits follow guidelines
- [ ] Branch is up to date with main

### PR Template

When you create a PR, fill out this template:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Changes Made
- Change 1
- Change 2

## Testing
How did you test these changes?

## Screenshots (if applicable)

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Follows coding standards
```

### PR Title

Use conventional commit format:
```
feat(agents): add sentiment analysis agent
fix(cli): handle empty query gracefully
docs: improve contribution guidelines
```

---

## 👀 Review Process

### What to Expect

1. **Automated Checks** - CI will run tests and build
2. **Maintainer Review** - A maintainer will review within 2-3 days
3. **Feedback** - You may receive change requests
4. **Iteration** - Make requested changes
5. **Approval** - Once approved, we'll merge

### Review Criteria

Reviewers will check:
- ✅ Code quality and style
- ✅ Tests are adequate
- ✅ Documentation is clear
- ✅ No breaking changes (or properly documented)
- ✅ Performance impact
- ✅ Security considerations

### Responding to Feedback

- Be open to suggestions
- Ask questions if unclear
- Make requested changes
- Push updates to your branch
- Re-request review when ready

---

## 🎯 Good First Issues

New to the project? Look for issues labeled:
- `good first issue` - Easy for beginners
- `help wanted` - We need help with these
- `documentation` - Docs improvements

---

## 🏗️ Project Structure

```
koda/
├── src/
│   ├── agents/          # Agent implementations
│   ├── ai/              # AI integration
│   ├── cli/             # CLI commands
│   ├── engine/          # Indexing engine
│   ├── tools/           # Utility tools
│   └── ...
├── tests/               # Test files
├── docs/                # Documentation
└── scripts/             # Build/deployment scripts
```

---

## 📚 Resources

- [README.md](README.md) - Project overview
- [QUICKSTART.md](QUICKSTART.md) - Quick start guide
- [Architecture Overview](docs/architecture.md) - System design
- [API Documentation](docs/api.md) - API reference

---

## 💬 Getting Help

- **GitHub Issues** - For bugs and features
- **Discussions** - For questions and ideas
- **Discord/Slack** - For real-time chat (if available)

---

## 🙏 Recognition

Contributors will be:
- Listed in our [CONTRIBUTORS.md](CONTRIBUTORS.md) file
- Mentioned in release notes
- Added to the GitHub contributors page

---

**Thank you for contributing to Koda! 🚀**
