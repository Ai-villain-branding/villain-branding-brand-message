# Database Migration Guide

This guide explains how to set up and migrate the database schema for the Brand Messaging Analyzer.

## Initial Setup

### 1. Base Schema

First, run the base schema to create the core tables:

```bash
# Using Node.js script
node run_schema.js "postgresql://postgres:password@host:port/postgres"

# Or using psql
psql "your_connection_string" -f supabase_schema.sql
```

This creates:
- `companies` table
- `brand_messages` table
- `screenshots` table
- Row Level Security (RLS) policies

### 2. Required Migrations (Run in Order)

Run these migrations in the exact order listed:

#### Migration 1: Analysis Mode
```bash
psql "your_connection_string" -f migration_add_analysis_mode.sql
```
Adds:
- `analysis_mode` column to `companies` (default: 'full_website')
- `pages_analyzed` column to `companies`

#### Migration 2: Message Categorization
```bash
psql "your_connection_string" -f migration_add_categorization.sql
```
Adds:
- `message_categories` table
- `category_id` column to `brand_messages`
- Indexes for performance

#### Migration 3: Screenshot Status
```bash
psql "your_connection_string" -f migration_add_screenshot_status.sql
```
Adds:
- `status` column to `screenshots` (default: 'success')
- Makes `image_url` nullable for failed attempts

### 3. Optional Migrations

#### HTML Evidence (Optional Feature)

If you want to enable HTML evidence storage for CloudFlare bypass:

```bash
psql "your_connection_string" -f migration_add_html_evidence.sql
```

This adds:
- `html_evidence_path` column to `screenshots` table

**Note:** The application will work without this migration. If the column doesn't exist, HTML evidence paths will be gracefully skipped.

To remove HTML evidence support later:

```bash
psql "your_connection_string" -f migration_remove_html_evidence.sql
```

## Migration Order Summary

```
1. supabase_schema.sql (base schema)
2. migration_add_analysis_mode.sql
3. migration_add_categorization.sql
4. migration_add_screenshot_status.sql
5. migration_add_html_evidence.sql (optional)
```

## Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Run each migration file in order
4. Verify tables and columns were created correctly

## Verification

After running all migrations, verify your schema:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check companies columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'companies';

-- Check screenshots columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'screenshots';

-- Check message_categories table exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'message_categories';
```

## Troubleshooting

### Error: "column already exists"
- The migration has already been run
- Use `IF NOT EXISTS` clauses (already included in migrations)
- Safe to skip

### Error: "relation does not exist"
- Base schema hasn't been run
- Run `supabase_schema.sql` first

### Error: "foreign key constraint"
- Migrations are out of order
- Run migrations in the exact order listed above

## Rollback

To rollback a specific migration, check the migration file comments or create reverse migrations. Most migrations use `IF NOT EXISTS` and `DROP COLUMN IF EXISTS` for safe rollback.

