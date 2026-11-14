# pi-code background bash: install the checkout into a clean pi, then show a command
# moving to the background at its timeout, a background dev server, /tasks, and task_stop.
Output background-bash.gif
Set Shell zsh
Set FontSize 16
Set Width 1280
Set Height 760
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 8
Env HOME "/tmp/pibg/home"
Env PI_CODING_AGENT_DIR "/tmp/pibg/home/.pi/agent"
Env PATH "$HOME_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
Env PS1 "%F{cyan}~/work%f $ "

Hide
Type "cd /tmp/pibg/work && clear"
Enter
Show

Type "pi install ./pi-code"
Sleep 0.5s
Enter
Sleep 4s

Type "BASH_DEFAULT_TIMEOUT_MS=5000 BASH_MAX_TIMEOUT_MS=5000 pi"
Sleep 0.5s
Enter
Hide
Sleep 8s
Show
Sleep 1s

Type@20ms "Run the build with bash: for i in $(seq 1 10); do echo compiling module $i; sleep 1; done; echo BUILD OK"
Sleep 0.8s
Enter
Sleep 30s

Type@20ms "Start a dev server in the background: python3 -m http.server 8765"
Sleep 0.6s
Enter
Sleep 10s

Type "/tasks"
Sleep 0.6s
Enter
Sleep 5s

Type@20ms "Stop the dev server with task_stop."
Sleep 0.6s
Enter
Sleep 10s

Type "/tasks"
Sleep 0.6s
Enter
Sleep 5s
Sleep 3s
