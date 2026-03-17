# Koda — terminal demo
# Run with: vhs assets/demo.tape

Output assets/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1000
Set Height 580
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 55ms
Set CursorBlink false

# ── Setup (hidden) ─────────────────────────────────────────────────────────────
Hide
Type "cd /Users/varunbilluri/AI && clear"
Enter
Sleep 500ms
Show

# ── Version ────────────────────────────────────────────────────────────────────
Sleep 500ms
Type "koda --version"
Sleep 300ms
Enter
Sleep 1s

# ── Index ──────────────────────────────────────────────────────────────────────
Type "koda init"
Sleep 300ms
Enter
Sleep 7s

# ── Status ─────────────────────────────────────────────────────────────────────
Type "koda status"
Sleep 300ms
Enter
Sleep 1.8s

# ── Interactive session ────────────────────────────────────────────────────────
Sleep 500ms
Type "koda"
Sleep 300ms
Enter
Sleep 2s

Type "help"
Sleep 300ms
Enter
Sleep 2.5s

Type "status"
Sleep 300ms
Enter
Sleep 2s

Type "quit"
Sleep 300ms
Enter
Sleep 1.2s
