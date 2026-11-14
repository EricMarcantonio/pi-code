#!/bin/zsh
# Builds an isolated pi instance: a throwaway HOME with only the model config copied in.
set -euo pipefail
ROOT=/tmp/pibg
rm -rf $ROOT; mkdir -p $ROOT/home/.pi/agent $ROOT/work
for f in auth.json models.json models-store.json; do
  [ -f "$HOME/.pi/agent/$f" ] && cp "$HOME/.pi/agent/$f" "$ROOT/home/.pi/agent/$f"
done
[ -d "$HOME/.pi/agent/bin" ] && cp -R "$HOME/.pi/agent/bin" "$ROOT/home/.pi/agent/bin"
# The pi launcher script lives in ~/.local/bin and points into ~/.pi/agent; keep using the real binary.
PI_VERSION=$(pi --version)
cat > $ROOT/home/.pi/agent/settings.json <<JSON
{
  "defaultModel": "deepseek-v4.1-flash:1017-cloud",
  "defaultProvider": "ollama",
  "hideThinkingBlock": true,
  "theme": "dark",
  "lastChangelogVersion": "$PI_VERSION"
}
JSON
ln -s $PI_CODE_CHECKOUT $ROOT/work/pi-code
echo ready
