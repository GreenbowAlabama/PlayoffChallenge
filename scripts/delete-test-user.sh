#!/bin/bash
#
# Delete Test User - Quick UI Retest Script
# Usage: ./scripts/delete-test-user.sh <apple_id_or_email>
#
# Examples:
#   ./scripts/delete-test-user.sh "001234.abc123def..."
#   ./scripts/delete-test-user.sh "test@example.com"
#

if [ -z "$1" ]; then
  echo "Usage: $0 <apple_id_or_email>"
  echo "Example: $0 test@example.com"
  exit 1
fi

IDENTIFIER="$1"

# Use Railway database connection
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:GBPNaovBYIBALLlVpZhoOXDtGYrYABNP@trolley.proxy.rlwy.net:41640/railway}"

echo "🔍 Searching for user: $IDENTIFIER"

# Show user before deletion
psql "$DATABASE_URL" -c "
  SELECT id, apple_id, email, name, state, created_at
  FROM users
  WHERE apple_id = '$IDENTIFIER' OR email = '$IDENTIFIER'
  LIMIT 1;
"

echo ""
read -p "❓ Delete this user? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "🗑️  Deleting user..."

  psql "$DATABASE_URL" -c "
    DELETE FROM users
    WHERE apple_id = '$IDENTIFIER' OR email = '$IDENTIFIER';
  "

  echo "✅ User deleted!"
  echo ""
  echo "📊 Remaining users:"
  psql "$DATABASE_URL" -c "SELECT COUNT(*) as total_users FROM users;"
else
  echo "❌ Deletion cancelled"
fi
