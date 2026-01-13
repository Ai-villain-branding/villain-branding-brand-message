#!/bin/bash

# Script to run Supabase schema using psql
# Usage: ./run_schema_psql.sh "postgresql://postgres:password@host:port/postgres"

if [ -z "$1" ]; then
    echo "❌ Missing database connection string"
    echo ""
    echo "Usage: ./run_schema_psql.sh \"postgresql://postgres:password@host:port/postgres\""
    echo ""
    echo "💡 To get your Supabase connection string:"
    echo "   1. Go to your Supabase Dashboard"
    echo "   2. Navigate to Settings → Database"
    echo "   3. Copy the 'Connection string' (URI format)"
    exit 1
fi

CONNECTION_STRING="$1"
SQL_FILE="../../database/schema.sql"

if [ ! -f "$SQL_FILE" ]; then
    echo "❌ SQL file not found: $SQL_FILE"
    exit 1
fi

echo "📄 Running SQL schema from $SQL_FILE..."
echo "🔌 Connecting to database..."

psql "$CONNECTION_STRING" -f "$SQL_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Schema executed successfully!"
else
    echo ""
    echo "❌ Error executing schema"
    exit 1
fi

