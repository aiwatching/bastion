#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Usage: ./scripts/publish.sh [patch|minor|major]
BUMP="${1:-patch}"

echo "==> Building..."
npm run build

echo "==> Running tests..."
npm test

echo "==> Bumping version ($BUMP)..."
npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")

echo "==> Publishing v$VERSION..."
npm publish

echo "==> Done! Published @aion0/bastion@$VERSION"
