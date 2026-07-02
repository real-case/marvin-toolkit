#!/usr/bin/env bash
# marvin-router — UserPromptSubmit hook (Lever 2 of the "marvin <intent>" convention).
#
# When a prompt starts with the "marvin" wake-word, inject context telling Claude to
# route the remainder to the single best-matching /marvin:<command> instead of answering
# ad-hoc. This makes the natural-language convention deterministic in ROUTING (it will
# always resolve to a Marvin command) while the model still picks which command.
#
# It is a NO-OP for every other prompt and FAILS OPEN — it never blocks or delays a
# prompt if anything is missing or unexpected.
#
# Enable in .claude/settings.json (this project) or ~/.claude/settings.json (all repos):
#   { "hooks": { "UserPromptSubmit": [ { "hooks": [
#       { "type": "command",
#         "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/marvin-router.sh" } ] } ] } }
#
# Docs: docs/commands.md → "Natural-language routing".

set -uo pipefail

# --- fail open: a missing dependency must never block a prompt ------------------
command -v jq >/dev/null 2>&1 || exit 0

input=$(cat 2>/dev/null) || exit 0
prompt=$(printf '%s' "$input" | jq -r '.prompt_text // .prompt // empty' 2>/dev/null) || exit 0
[ -n "$prompt" ] || exit 0

# --- match a leading "marvin" wake-word, separated by space or colon -----------
# (apostrophe/other punctuation deliberately excluded so "marvin's server" is prose)
shopt -s nocasematch
[[ "$prompt" =~ ^[[:space:]]*marvin([[:space:]:]+(.*))?[[:space:]]*$ ]] || exit 0
intent="${BASH_REMATCH[2]:-}"

# trim surrounding whitespace; bare "marvin" opens help
intent="${intent#"${intent%%[![:space:]]*}"}"
intent="${intent%"${intent##*[![:space:]]}"}"
[ -n "$intent" ] || intent="help"

# --- prose guard: if the word after "marvin" is ordinary English, don't hijack --
# Keeps sentences such as "marvin is slow", "marvin should ...", "marvin the server"
# flowing through as normal prompts. Errs toward pass-through.
first=$(printf '%s' "$intent" | tr '[:upper:]' '[:lower:]' | awk '{print $1}' | tr -cd '[:alpha:]')
case " is are was were be been being am should would could can cant will wont may might must need needs has have had do does did doesnt didnt looks seems appears feels the a an this that these those it its they them their there here plugin server repo repository toolkit and but or so because also just really still now then why how what when who where which " in
  *" ${first} "*) exit 0 ;;
esac

# --- route: tell Claude to run the matching marvin command ----------------------
ctx="The user's message begins with the \"marvin\" wake-word — an explicit request to run a Marvin plugin command, not an ordinary question. Interpret the remainder as the command intent and act on it: pick the single best-matching /marvin:<command> and run it (load its SKILL / invoke the prompt), passing along any arguments contained in the intent. If nothing matches well, list the closest /marvin: commands and ask which was meant. Do not answer ad-hoc. Command intent: \"${intent}\""

jq -cn --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}'
exit 0
