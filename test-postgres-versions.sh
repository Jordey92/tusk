#!/bin/bash
# Test Tusk against multiple PostgreSQL versions

set -e

echo "Testing Tusk against multiple PostgreSQL versions..."
echo ""

# PostgreSQL versions to test
VERSIONS=("13" "14" "15" "16" "17")
PORTS=("5432" "5433" "5434" "5435" "5436")

# Test results
RESULTS=()

for i in "${!VERSIONS[@]}"; do
  VERSION="${VERSIONS[$i]}"
  PORT="${PORTS[$i]}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Testing PostgreSQL ${VERSION} (port ${PORT})..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Start the container
  echo "Starting postgres-${VERSION} container..."
  docker-compose -f docker-compose.test.yml up -d "postgres-${VERSION}"

  # Wait for PostgreSQL to be ready
  echo "Waiting for PostgreSQL to be ready..."
  sleep 5

  # Set environment variables for this test
  export DB_HOST=localhost
  export DB_PORT=${PORT}
  export DB_NAME=migrate_tool_test
  export DB_USER=test_user
  export DB_PASSWORD=test_password

  # Run tests
  TEST_PASSED=true

  echo "Running Tusk tests..."
  if bun test 2>&1 | grep -q "0 fail"; then
    echo "✅ All tests passed on PostgreSQL ${VERSION}"
    RESULTS+=("✅ PostgreSQL ${VERSION}: PASS")
  else
    echo "❌ Tests failed on PostgreSQL ${VERSION}"
    RESULTS+=("❌ PostgreSQL ${VERSION}: FAIL")
    TEST_PASSED=false
  fi

  # Stop and remove the container
  echo "Stopping postgres-${VERSION} container..."
  docker-compose -f docker-compose.test.yml down "postgres-${VERSION}"

  echo ""
done

# Clean up all volumes
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cleaning up..."
docker-compose -f docker-compose.test.yml down -v

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Results Summary:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for result in "${RESULTS[@]}"; do
  echo "$result"
done
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
