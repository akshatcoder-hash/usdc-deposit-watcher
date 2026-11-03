#!/bin/sh
# Fails if a staged file is .env or looks like it contains a key. Run by the pre-commit hook.
files=$(git diff --cached --name-only --diff-filter=ACM | grep -v -E "^(scripts/check-secrets.sh|bun.lock)$")
for f in $files; do
  case "$f" in .env|.env.*) [ "$f" = ".env.example" ] || { echo "refusing to commit $f"; exit 1; };; esac
done
if [ -n "$files" ] && git diff --cached -U0 -- $files | grep -E '^\+.*(api-key=[0-9a-f-]{20,}|HELIUS_API_KEY=[^[:space:]]+|[1-9A-HJ-NP-Za-km-z]{80,})' | grep -v 'HELIUS_API_KEY=$' ; then
  echo "possible secret in staged changes"; exit 1
fi
