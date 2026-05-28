#!/usr/bin/env bash
# -------------------------------------------------------------------
# rebrand.sh — idempotent white-label script for the platform-librechat fork
#
# Usage:  bash scripts/rebrand.sh [BRAND]
#         BRAND defaults to "1ma"
#
# Safe to run repeatedly — every substitution is a no-op when the
# target text is already the branded version.
#
# What it does NOT touch (by design):
#   - Code comments / JSDoc (not user-visible)
#   - package.json repository URLs (upstream links)
#   - useAppStartup.ts / useNewConvo.ts (runtime fallback guards)
#   - helm/ charts (not used in Docker deploys)
#   - .github/ISSUE_TEMPLATE/ (GitHub-only)
#   - npm package names / Docker registry URLs (upstream infra)
# -------------------------------------------------------------------
set -euo pipefail

BRAND="${1:-1ma}"
BRAND_LOWER=$(echo "$BRAND" | tr '[:upper:]' '[:lower:]')

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGED=0

# Helper: sed in-place (macOS vs GNU)
_sed_i() {
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

# Helper: replace and count
replace_in_file() {
  local pattern="$1" replacement="$2" file="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    _sed_i "s|$pattern|$replacement|g" "$file"
    echo "  [fixed] $file"
    CHANGED=$((CHANGED + 1))
  fi
}

echo "=== Rebrand: LibreChat -> ${BRAND} ==="
echo ""

# ---------------------------------------------------------------
# A. Locale files (all languages)
# ---------------------------------------------------------------
echo "--- A. Locale files ---"
LOCALES_DIR="$REPO_ROOT/client/src/locales"

for translation in "$LOCALES_DIR"/*/translation.json; do
  [ -f "$translation" ] || continue

  # Generic: any remaining "LibreChat" inside JSON string values
  # This catches com_agents_mcp_trust_subtext, com_ui_admin_access_warning,
  # and any NEW keys upstream might add in future merges
  if grep -q '"LibreChat"' "$translation" 2>/dev/null || \
     grep -q 'LibreChat' "$translation" 2>/dev/null; then

    # Targeted replacements (safe for JSON context)
    _sed_i "s|verified by LibreChat|verified by ${BRAND}|g" "$translation"
    _sed_i "s|librechat\\.yaml|${BRAND_LOWER}.yaml|g" "$translation"

    # Catch-all for any other user-visible "LibreChat" in JSON values
    # Matches: ": "...LibreChat..." pattern (inside JSON string values only)
    _sed_i "s|LibreChat|${BRAND}|g" "$translation"

    echo "  [fixed] $translation"
    CHANGED=$((CHANGED + 1))
  fi
done

# Also handle packages/client locale if it exists
PKG_LOCALE="$REPO_ROOT/packages/client/src/locales/en/translation.json"
if [ -f "$PKG_LOCALE" ] && grep -q "LibreChat" "$PKG_LOCALE" 2>/dev/null; then
  _sed_i "s|LibreChat|${BRAND}|g" "$PKG_LOCALE"
  echo "  [fixed] $PKG_LOCALE"
  CHANGED=$((CHANGED + 1))
fi

# ---------------------------------------------------------------
# B. HTML — client/index.html
# ---------------------------------------------------------------
echo ""
echo "--- B. HTML ---"
INDEX_HTML="$REPO_ROOT/client/index.html"
replace_in_file "<title>LibreChat</title>" "<title>${BRAND}</title>" "$INDEX_HTML"
replace_in_file 'content="LibreChat' "content=\"${BRAND}" "$INDEX_HTML"

# ---------------------------------------------------------------
# C. Docker compose files
# ---------------------------------------------------------------
echo ""
echo "--- C. Docker compose ---"

COMPOSE_FILES=(
  "$REPO_ROOT/docker-compose.yml"
  "$REPO_ROOT/deploy-compose.yml"
  "$REPO_ROOT/.devcontainer/docker-compose.yml"
  "$REPO_ROOT/utils/docker/test-compose.yml"
)

for compose in "${COMPOSE_FILES[@]}"; do
  [ -f "$compose" ] || continue
  # container_name: LibreChat  or  LibreChat-API  or  LibreChat-NGINX
  replace_in_file "container_name: LibreChat-API" "container_name: ${BRAND_LOWER}-api" "$compose"
  replace_in_file "container_name: LibreChat-NGINX" "container_name: ${BRAND_LOWER}-nginx" "$compose"
  replace_in_file "container_name: LibreChat$" "container_name: ${BRAND_LOWER}-api" "$compose"
  # Some variations without suffix
  if grep -q "container_name:.*LibreChat" "$compose" 2>/dev/null; then
    _sed_i "s|container_name:.*LibreChat.*|container_name: ${BRAND_LOWER}-api|g" "$compose"
    echo "  [fixed] $compose (container_name catch-all)"
    CHANGED=$((CHANGED + 1))
  fi
  # MONGO_URI
  replace_in_file "mongodb://mongodb:27017/LibreChat" "mongodb://mongodb:27017/${BRAND_LOWER}" "$compose"
done

# ---------------------------------------------------------------
# D. Config — librechat.example.yaml
# ---------------------------------------------------------------
echo ""
echo "--- D. Config YAML ---"
YAML_CFG="$REPO_ROOT/librechat.example.yaml"
if [ -f "$YAML_CFG" ]; then
  replace_in_file "Welcome to LibreChat" "Welcome to ${BRAND}" "$YAML_CFG"
  replace_in_file "Terms of Service for LibreChat" "Terms of Service for ${BRAND}" "$YAML_CFG"
  replace_in_file "Terms and Conditions for LibreChat" "Terms and Conditions for ${BRAND}" "$YAML_CFG"
  replace_in_file "package from LibreChat" "package from ${BRAND}" "$YAML_CFG"
  replace_in_file "permission from LibreChat" "permission from ${BRAND}" "$YAML_CFG"
  replace_in_file "contact@librechat.ai" "contact@${BRAND_LOWER}.ai" "$YAML_CFG"
  # Comments that client sees when editing config
  replace_in_file "LibreChat does not configure" "${BRAND} does not configure" "$YAML_CFG"
  replace_in_file "LibreChat uses its own" "${BRAND} uses its own" "$YAML_CFG"
  replace_in_file "LibreChat hat diesen" "${BRAND} hat diesen" "$YAML_CFG"
  # Example paths in comments
  replace_in_file "/home/user/LibreChat/" "/home/user/${BRAND_LOWER}/" "$YAML_CFG"
  # MCP server review notice (note: upstream uses mixed case "Librechat")
  replace_in_file "Librechat hasn.t reviewed" "${BRAND} hasn't reviewed" "$YAML_CFG"
  # Domain in allowedDomains list
  _sed_i "s|    - 'librechat\.ai'|    - '${BRAND_LOWER}.ai'|g" "$YAML_CFG"
  if grep -q "'${BRAND_LOWER}\.ai'" "$YAML_CFG" 2>/dev/null; then
    : # already done
  fi
fi

# ---------------------------------------------------------------
# E. Env — .env.example
# ---------------------------------------------------------------
echo ""
echo "--- E. Environment ---"
ENV_EXAMPLE="$REPO_ROOT/.env.example"
if [ -f "$ENV_EXAMPLE" ]; then
  replace_in_file "APP_TITLE=LibreChat" "APP_TITLE=${BRAND}" "$ENV_EXAMPLE"
  # MONGO_URI default
  replace_in_file "mongodb://127.0.0.1:27017/LibreChat" "mongodb://127.0.0.1:27017/${BRAND_LOWER}" "$ENV_EXAMPLE"
  # Header banner
  replace_in_file "LibreChat Configuration" "${BRAND} Configuration" "$ENV_EXAMPLE"
  replace_in_file "configuring your LibreChat" "configuring your ${BRAND}" "$ENV_EXAMPLE"
  # Comment mentioning LibreChat
  replace_in_file "in front of your LibreChat" "in front of your ${BRAND}" "$ENV_EXAMPLE"
fi

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo ""
if [ "$CHANGED" -gt 0 ]; then
  echo "=== Done: ${CHANGED} file(s) updated to '${BRAND}' ==="
else
  echo "=== Done: everything already branded as '${BRAND}' — no changes ==="
fi

# Quick audit: show any remaining "LibreChat" in user-visible files
echo ""
echo "--- Audit: remaining 'LibreChat' in user-visible files ---"
echo "(Excluding: registry URLs, librechat.yaml file refs, librechat.ai URLs, HTTP headers, npm packages)"

# Grep for LibreChat but exclude known-safe patterns:
#   - registry.librechat.ai  (Docker registry)
#   - librechat.yaml         (config file name — cannot rename)
#   - librechat_yaml         (docs slug)
#   - librechat.ai/          (documentation URLs)
#   - x-librechat-           (HTTP headers)
#   - librechat-data-        (npm package names)
#   - librechat-rag-         (RAG service image)
#   - librechat-dev          (dev image)
#   - REDIS_KEY_PREFIX       (internal key)
#   - OTEL_SERVICE_NAME      (internal telemetry)
#   - CONFIG_PATH            (file path reference)
REMAINING=$(grep -rin "LibreChat" \
  "$REPO_ROOT/client/src/locales/"*/translation.json \
  "$REPO_ROOT/client/index.html" \
  "$REPO_ROOT/docker-compose.yml" \
  "$REPO_ROOT/deploy-compose.yml" \
  "$REPO_ROOT/librechat.example.yaml" \
  "$REPO_ROOT/.env.example" \
  2>/dev/null \
  | grep -iv "registry\.librechat" \
  | grep -iv "librechat\.yaml" \
  | grep -iv "librechat_yaml" \
  | grep -iv "librechat\.ai/" \
  | grep -iv "x-librechat-" \
  | grep -iv "librechat-data-" \
  | grep -iv "librechat-rag-" \
  | grep -iv "librechat-dev" \
  | grep -iv "REDIS_KEY_PREFIX" \
  | grep -iv "OTEL_SERVICE_NAME" \
  | grep -iv "CONFIG_PATH" \
  || true)

if [ -n "$REMAINING" ]; then
  echo "WARNING: These lines still contain 'LibreChat':"
  echo "$REMAINING"
  exit 1
else
  echo "All clear — no user-visible 'LibreChat' branding found."
fi
