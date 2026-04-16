#!/usr/bin/env bash
set -euo pipefail

# dispatch.sh — Phase 2 batch dispatcher for the task pipeline
#
# Creates git worktrees for each spec and launches headless claude -p sessions.
# Supports parallel (independent tasks) and sequential (dependent tasks) modes.
#
# Usage:
#   ./dispatch.sh --mode parallel specs/task-1.md specs/task-2.md
#   ./dispatch.sh --mode sequential specs/task-1.md specs/task-2.md
#
# Requirements:
#   - git repository with clean working state
#   - claude CLI installed and authenticated
#   - gh CLI installed and authenticated
#   - specs must have passed DoR gate (Status: ready)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(dirname "$SCRIPT_DIR")"
WORKTREE_BASE=".worktrees"
PROMPT_TMP_DIR=""
MODE=""
SPEC_FILES=()
BASE_BRANCH=""

# --- Helpers ---

usage() {
  cat <<'USAGE'
Usage: dispatch.sh --mode <parallel|sequential> <spec1.md> [spec2.md ...]

Options:
  --mode parallel     Run all specs concurrently in isolated worktrees
  --mode sequential   Run specs one at a time; each sees previous changes

Arguments:
  spec files          Path to spec .md files that passed the DoR gate
USAGE
  exit 1
}

log() { printf "\033[1;34m[dispatch]\033[0m %s\n" "$1"; }
err() { printf "\033[1;31m[dispatch]\033[0m %s\n" "$1" >&2; }
ok()  { printf "\033[1;32m[dispatch]\033[0m %s\n" "$1"; }

slug_from_spec() {
  local spec_file="$1"
  basename "$spec_file" .md | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//'
}

cleanup() {
  if [[ -n "$PROMPT_TMP_DIR" && -d "$PROMPT_TMP_DIR" ]]; then
    rm -rf "$PROMPT_TMP_DIR"
  fi
  log "Cleaning up worktrees..."
  for spec_file in "${SPEC_FILES[@]}"; do
    local slug
    slug=$(slug_from_spec "$spec_file")
    local worktree_path="$WORKTREE_BASE/task-$slug"
    if [[ -d "$worktree_path" ]]; then
      git worktree remove "$worktree_path" --force 2>/dev/null || true
    fi
  done
}

# --- Validation ---

validate_spec() {
  local spec_file="$1"

  if [[ ! -f "$spec_file" ]]; then
    err "Spec file not found: $spec_file"
    return 1
  fi

  if ! grep -q "^Status: ready" "$spec_file"; then
    err "Spec has not passed DoR gate (missing 'Status: ready'): $spec_file"
    return 1
  fi

  if ! grep -q "^Type:" "$spec_file"; then
    err "Spec missing Type field: $spec_file"
    return 1
  fi

  return 0
}

# --- Prompt Construction ---

build_prompt() {
  local spec_file="$1"
  local prompt_file="$2"
  local spec_content
  local executor_instructions
  local claude_md=""

  spec_content=$(cat "$spec_file")
  executor_instructions=$(cat "$PACK_DIR/agents/executor.md")

  # Read CLAUDE.md if it exists (project conventions)
  if [[ -f "CLAUDE.md" ]]; then
    claude_md=$(cat "CLAUDE.md")
  fi

  cat > "$prompt_file" <<PROMPT
You are an autonomous execution agent. Follow the instructions below exactly.

---

## Executor Instructions

$executor_instructions

---

## Project Conventions

$claude_md

---

## Spec to Implement

$spec_content

---

## Final Reminders

- Implement exactly what the spec says. No more, no less.
- Run tests, lint, type-check, and build before creating the PR.
- Document any ambiguity as a SPEC GAP in the PR description.
- If blocked, create a draft PR with the blocker description.
- No AI attribution in commits or PR description.
PROMPT
}

# --- Execution ---

run_spec() {
  local spec_file="$1"
  local slug
  slug=$(slug_from_spec "$spec_file")
  local branch_name="task/$slug"
  local worktree_path="$WORKTREE_BASE/task-$slug"
  local prompt_file="$PROMPT_TMP_DIR/prompt-$slug.txt"

  log "[$slug] Creating worktree on branch $branch_name..."

  # Create worktree with a new branch from the base
  git worktree add "$worktree_path" -b "$branch_name" "$BASE_BRANCH" 2>/dev/null || {
    # Branch may already exist — try without -b
    git worktree add "$worktree_path" "$branch_name" 2>/dev/null || {
      err "[$slug] Failed to create worktree"
      return 1
    }
  }

  log "[$slug] Building executor prompt..."
  build_prompt "$spec_file" "$prompt_file"

  log "[$slug] Launching headless agent..."
  if claude -p "$(cat "$prompt_file")" --cwd "$worktree_path" 2>&1; then
    ok "[$slug] Completed successfully"
    return 0
  else
    err "[$slug] Agent exited with error"
    return 1
  fi
}

# --- Main ---

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        MODE="$2"
        shift 2
        ;;
      --help|-h)
        usage
        ;;
      *)
        SPEC_FILES+=("$1")
        shift
        ;;
    esac
  done

  # Validate arguments
  if [[ -z "$MODE" ]]; then
    err "Missing --mode argument"
    usage
  fi

  if [[ "$MODE" != "parallel" && "$MODE" != "sequential" ]]; then
    err "Invalid mode: $MODE (must be 'parallel' or 'sequential')"
    usage
  fi

  if [[ ${#SPEC_FILES[@]} -eq 0 ]]; then
    err "No spec files provided"
    usage
  fi

  # Pre-flight checks
  if ! command -v claude &>/dev/null; then
    err "claude CLI not found. Install it first."
    exit 1
  fi

  if ! command -v gh &>/dev/null; then
    err "gh CLI not found. Install it first."
    exit 1
  fi

  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    err "Not inside a git repository"
    exit 1
  fi

  # Check for clean working state
  if [[ -n "$(git status --porcelain)" ]]; then
    err "Working directory is not clean. Commit or stash changes before dispatching."
    exit 1
  fi

  # Validate all specs before starting
  log "Validating specs..."
  for spec_file in "${SPEC_FILES[@]}"; do
    if ! validate_spec "$spec_file"; then
      exit 1
    fi
  done
  ok "All ${#SPEC_FILES[@]} specs validated"

  # Setup
  BASE_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  PROMPT_TMP_DIR=$(mktemp -d)
  mkdir -p "$WORKTREE_BASE"

  trap cleanup EXIT

  log "Mode: $MODE | Base branch: $BASE_BRANCH | Specs: ${#SPEC_FILES[@]}"

  # Execute
  local pids=()
  local results=()
  local failed=0

  if [[ "$MODE" == "parallel" ]]; then
    log "Launching ${#SPEC_FILES[@]} agents in parallel..."

    for spec_file in "${SPEC_FILES[@]}"; do
      run_spec "$spec_file" &
      pids+=($!)
    done

    # Wait for all and collect results
    for i in "${!pids[@]}"; do
      if wait "${pids[$i]}"; then
        results+=("$(slug_from_spec "${SPEC_FILES[$i]}"): SUCCESS")
      else
        results+=("$(slug_from_spec "${SPEC_FILES[$i]}"): FAILED")
        ((failed++))
      fi
    done

  elif [[ "$MODE" == "sequential" ]]; then
    log "Running ${#SPEC_FILES[@]} specs sequentially..."

    for spec_file in "${SPEC_FILES[@]}"; do
      if run_spec "$spec_file"; then
        results+=("$(slug_from_spec "$spec_file"): SUCCESS")
        # In sequential mode, update base for next task
        local slug
        slug=$(slug_from_spec "$spec_file")
        BASE_BRANCH="task/$slug"
        git fetch origin 2>/dev/null || true
      else
        results+=("$(slug_from_spec "$spec_file"): FAILED")
        ((failed++))
        err "Sequential mode: stopping after failure"
        break
      fi
    done
  fi

  # Report
  echo ""
  echo "==============================="
  echo " Dispatch Results"
  echo "==============================="
  for result in "${results[@]}"; do
    echo "  $result"
  done
  echo "==============================="

  if [[ $failed -gt 0 ]]; then
    err "$failed spec(s) failed"
    exit 1
  else
    ok "All specs completed successfully"
  fi
}

main "$@"
