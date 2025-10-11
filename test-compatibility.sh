#!/bin/bash
# Test Tusk across multiple Node.js versions

set -e

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "Testing Tusk compatibility across Node.js versions..."
echo ""

# Node versions to test
VERSIONS=("14" "16" "18" "20" "22")

# Save current version
ORIGINAL_VERSION=$(nvm current)

for VERSION in "${VERSIONS[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Testing Node.js ${VERSION}..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Try to install and use the version
  if ! nvm install "${VERSION}" 2>/dev/null; then
    echo "❌ Could not install Node.js ${VERSION}"
    continue
  fi

  nvm use "${VERSION}" >/dev/null 2>&1

  echo "Node version: $(node --version)"
  echo "npm version: $(npm --version)"
  echo ""

  # Test building
  echo "Testing build..."
  if npm run build >/dev/null 2>&1; then
    echo "✅ Build succeeded"
  else
    echo "❌ Build failed"
    continue
  fi

  # Test CLI import
  echo "Testing CLI..."
  if node dist/cli.js --version >/dev/null 2>&1; then
    echo "✅ CLI works"
  else
    echo "❌ CLI failed"
  fi

  # Test programmatic import
  echo "Testing programmatic import..."
  if node -e "import('./dist/index.js').then(() => console.log('✅ Import works')).catch(() => console.log('❌ Import failed'))"; then
    :
  else
    echo "❌ Module import failed"
  fi

  echo ""
done

# Restore original version
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Restoring Node.js version..."
nvm use "${ORIGINAL_VERSION}" >/dev/null 2>&1
echo "✅ Restored to $(node --version)"
