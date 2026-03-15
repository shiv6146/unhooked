#!/bin/bash
# Writes GEMINI_API_KEY from the shell environment into the extension's _env.json.
# Run this before loading the extension in Chrome.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/extension/_env.json"

if [ -z "$GEMINI_API_KEY" ]; then
  echo "WARNING: GEMINI_API_KEY is not set. Creating empty _env.json."
  echo '{}' > "$ENV_FILE"
else
  KEY_LEN=${#GEMINI_API_KEY}
  echo "Writing GEMINI_API_KEY (${KEY_LEN} chars) to $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
{
  "GEMINI_API_KEY": "$GEMINI_API_KEY",
  "CURATOR_GOAL": "${CURATOR_GOAL:-AI news, tech startups, interesting content}"
}
EOF
  echo "Done. Extension will auto-load the key on install/startup."
fi
