#!/usr/bin/env bash
# Scripted terminal demo for VHS — no API key required.
# Run: bash assets/demo-recording.sh

set -euo pipefail

CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
GRAY=$'\033[90m'
WHITE=$'\033[97m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# pause sleeps for a specified number of seconds (default 0.8) to create brief pauses in the demo output.
pause() { sleep "${1:-0.8}"; }

clear
echo ""
echo -e "${BOLD}${CYAN}  Koda${RESET}${GRAY} v0.1.2${RESET}"
echo -e "${GRAY}  Agentic coding in your terminal — free & open source${RESET}"
echo ""
echo -e "${GRAY}  ${WHITE}my-app${GRAY} (main) · index ready · ${WHITE}gpt-4o${RESET}"
echo ""
echo -e "${GRAY}  Ask in plain English, or use /commands (type /help).${RESET}"
echo -e "${GRAY}  Examples: fix the login bug · explain src/auth.ts · /commit${RESET}"
echo ""
pause 1.2

echo -ne "${CYAN}> ${RESET}"
pause 0.4
echo -e "${WHITE}fix login bug after password reset${RESET}"
pause 0.6
echo ""

echo -e "${GRAY}  ◐ thinking (1s)${RESET}"
pause 1.0
echo -e "${GRAY}  INFO ROUTER: SIMPLE task — reasoning engine${RESET}"
pause 0.5
echo -e "${GRAY}  INFO searching repository${RESET}"
pause 0.6
echo -e "${GRAY}  READ src/auth/reset-service.ts${RESET}"
pause 0.5
echo -e "${GRAY}  SEARCH \"password reset token\"${RESET}"
pause 0.6
echo -e "${GRAY}  WRITE src/auth/reset-service.ts (3 lines)${RESET}"
pause 0.5
echo -e "${GRAY}  RUN pnpm test --filter reset${RESET}"
pause 1.2
echo ""
echo -e "${GREEN}  ✓ Root cause: reset token was not invalidated after use.${RESET}"
echo -e "${GRAY}  Patched reset-service.ts — tests passing.${RESET}"
echo ""
pause 1.5

echo -ne "${CYAN}> ${RESET}"
pause 0.3
echo -e "${WHITE}/commit${RESET}"
pause 0.5
echo ""
echo -e "${GRAY}  ◐ Generating commit message from staged diff…${RESET}"
pause 1.0
echo ""
echo -e "${BOLD}  Proposed commit${RESET}"
echo ""
echo -e "${CYAN}  fix(auth): invalidate reset token after password reset${RESET}"
echo ""
echo -e "${BOLD}  Staged files${RESET}"
echo -e "${GRAY}  M  src/auth/reset-service.ts${RESET}"
echo ""
echo -e "${GRAY}  [Koda] Allow operation: git_commit${RESET}"
echo -e "${GRAY}  Proceed? [Y/n] ${RESET}"
pause 0.8
echo -e "${GREEN}  ✓ Committed successfully.${RESET}"
echo -e "${GRAY}  [main a1b2c3d] fix(auth): invalidate reset token after password reset${RESET}"
echo ""
pause 1.2

echo -ne "${CYAN}> ${RESET}"
pause 0.3
echo -e "${WHITE}/help${RESET}"
pause 0.4
echo ""
echo -e "${BOLD}  Slash commands:${RESET}"
echo ""
echo -e "${BOLD}  Git & code${RESET}"
echo -e "    ${CYAN}/commit${RESET}               AI commit message from staged diff + approval"
echo -e "    ${CYAN}/diff${RESET}                 Show pending git changes"
echo -e "${BOLD}  Config & auth${RESET}"
echo -e "    ${CYAN}/login${RESET}                Configure AI provider (Azure · OpenAI · Anthropic · Ollama)"
echo -e "${GRAY}  Commands marked ${YELLOW}[wip]${GRAY} show guidance only or are not fully implemented yet.${RESET}"
echo ""
pause 2
