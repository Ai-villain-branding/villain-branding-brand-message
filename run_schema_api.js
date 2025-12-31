require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Get credentials from environment or use provided ones
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gbnysktqhdsdepbfcnsg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdibnlza3RxaGRzZGVwYmZjbnNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQ3MjEzOSwiZXhwIjoyMDgyMDQ4MTM5fQ.DKzdSz_4lolD6SbbxTEWztdcOJammxL0FWvuQlaITz8';

async function runSchema() {
    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'supabase_schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('📄 Reading SQL schema file...');
        console.log(`🔗 Supabase URL: ${SUPABASE_URL}`);
        
        // Supabase doesn't support executing arbitrary SQL via REST API
        // We need to use the Management API or direct PostgreSQL connection
        // Let's try using the Supabase Management API endpoint
        
        const projectRef = SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];
        
        if (!projectRef) {
            console.error('❌ Could not extract project reference from Supabase URL');
            process.exit(1);
        }
        
        console.log(`📋 Project reference: ${projectRef}`);
        
        // Try using Supabase Management API
        // Note: This requires the Management API access token, not the service role key
        // The Management API is different from the REST API
        
        console.log('\n⚠️  Supabase REST API does not support executing arbitrary SQL.');
        console.log('💡 To execute the schema, you have two options:\n');
        
        console.log('Option 1: Supabase Dashboard (Easiest)');
        console.log('   1. Go to: https://supabase.com/dashboard/project/' + projectRef);
        console.log('   2. Navigate to SQL Editor (left sidebar)');
        console.log('   3. Click "New query"');
        console.log('   4. Copy and paste the SQL from supabase_schema.sql');
        console.log('   5. Click "Run" or press Cmd+Enter\n');
        
        console.log('Option 2: Get Database Connection String');
        console.log('   1. Go to: https://supabase.com/dashboard/project/' + projectRef + '/settings/database');
        console.log('   2. Scroll to "Connection string" section');
        console.log('   3. Copy the "URI" format connection string');
        console.log('   4. Run: node run_sql.js "your_connection_string"\n');
        
        // Display the SQL content for easy copy-paste
        console.log('📋 SQL Content (copy this to Supabase SQL Editor):\n');
        console.log('─'.repeat(60));
        console.log(sql);
        console.log('─'.repeat(60));
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

runSchema();

