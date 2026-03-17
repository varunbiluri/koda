# Koda — terminal demo
# Run with: vhs assets/demo.tape

Output assets/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1100
Set Height 620
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 40ms
Set CursorBlink false

# ── Start ──────────────────────────────────────────────────────────────────────

Sleep 800ms

# Show the repo
Type "ls src/"
Sleep 300ms
Enter
Sleep 1.2s

# Index the repository
Type "koda init"
Sleep 400ms
Enter
Sleep 5s

# Ask a question
Type "koda ask 'how does the authentication middleware work'"
Sleep 400ms
Enter
Sleep 6s

# Start the conversational session
Type "koda"
Sleep 400ms
Enter
Sleep 2s

# First question in the session
Type "explain how the query engine works"
Sleep 400ms
Enter
Sleep 5s

# Second — trigger a task
Type "add a /health endpoint to the API router"
Sleep 400ms
Enter
Sleep 7s

# Exit
Type "quit"
Sleep 400ms
Enter
Sleep 1s
