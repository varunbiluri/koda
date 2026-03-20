# Koda — 45-second bug fix demo
# Shows: broken test → koda fix → tests passing
# Run with: vhs assets/fix-demo.tape

Output assets/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 960
Set Height 580
Set Theme "Dracula"
Set Padding 20
Set TypingSpeed 55ms
Set CursorBlink false

# ── Setup ─────────────────────────────────────────────────────────────────────
Hide
Type "cd /tmp/demo-repo && clear"
Enter
Sleep 300ms
Show

# ── Show the failing test first (before) ──────────────────────────────────────
Sleep 400ms
Type "pnpm test 2>&1 | tail -6"
Enter
Sleep 800ms

# Simulated failing test output
Type "  FAIL  tests/auth/reset.test.ts"
Enter
Sleep 100ms
Type "    ✕ login after reset (expected 200, got 401)"
Enter
Sleep 100ms
Type "    Error: token was reused after password reset"
Enter
Sleep 500ms
Type ""
Enter

Sleep 1.2s

# ── The fix ───────────────────────────────────────────────────────────────────
Type "koda fix "
Sleep 150ms
Type '"login fails after password reset"'
Sleep 300ms
Enter

Sleep 800ms

# Execution stages — rendered by koda
Sleep 1s
# Header appears

Sleep 3.5s
# Stage lines: searching, root cause, patching

Sleep 2.5s
# Verification: running tests

Sleep 1.5s
# Success

Sleep 2.5s
# Pause on ✓ Done + viral line

# ── Show tests passing now (after) ────────────────────────────────────────────
Type "pnpm test 2>&1 | tail -4"
Enter
Sleep 700ms

Type "  ✓  tests/auth/reset.test.ts"
Enter
Sleep 100ms
Type "  Test Files  1 passed"
Enter
Sleep 100ms
Type "  Tests       12 passed"
Enter

Sleep 2s

# ── End ──────────────────────────────────────────────────────────────────────
Sleep 1.5s
