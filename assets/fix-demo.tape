# Koda — fix bug demo
# Records the primary workflow: koda fix end-to-end
# Run with: vhs assets/fix-demo.tape

Output assets/fix-demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 520
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 60ms
Set CursorBlink false

# ── Setup ───────────────────────────────────────────────────────────────────────
Hide
Type "cd /Users/varunbilluri/AI && clear"
Enter
Sleep 400ms
Show

# ── Show the command ─────────────────────────────────────────────────────────────
Sleep 600ms
Type "koda fix "
Sleep 200ms
Type '"null pointer in auth middleware"'
Sleep 400ms
Enter

# ── Header appears ───────────────────────────────────────────────────────────────
Sleep 1.2s

# ── Step 1: execution ────────────────────────────────────────────────────────────
Sleep 3.5s   # let stage lines render

# ── Verification ─────────────────────────────────────────────────────────────────
Sleep 3s

# ── Success ──────────────────────────────────────────────────────────────────────
Sleep 1.5s

# ── Pause on result ──────────────────────────────────────────────────────────────
Sleep 2.5s

# ── Show koda add next ──────────────────────────────────────────────────────────
Type "koda add "
Sleep 200ms
Type '"rate limiting middleware"'
Sleep 300ms
Enter
Sleep 500ms

# End
Sleep 2s
