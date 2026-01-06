require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error('❌ Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
    process.exit(1);
}

async function runSchema() {
    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, 'supabase_schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('📄 Reading SQL schema file...');
        
        // Supabase REST API doesn't support executing arbitrary SQL directly
        // We need to use the Management API or connection string
        // Let's try using the Supabase REST API with the SQL endpoint
        // Note: This may require special permissions
        
        const supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
        const apiUrl = `${supabaseUrl}/rest/v1/rpc/exec_sql`;
        
        console.log('⚠️  Supabase REST API does not support executing arbitrary SQL for security reasons.');
        console.log('💡 Please use one of these methods:');
        console.log('');
        console.log('Method 1: Supabase Dashboard (Recommended)');
        console.log('   1. Go to: https://supabase.com/dashboard');
        console.log('   2. Select your project');
        console.log('   3. Navigate to SQL Editor');
        console.log('   4. Paste the contents of supabase_schema.sql');
        console.log('   5. Click Run');
        console.log('');
        console.log('Method 2: Using psql with connection string');
        console.log('   1. Get connection string from Supabase Dashboard → Settings → Database');
        console.log('   2. Run: psql "your_connection_string" -f supabase_schema.sql');
        console.log('');
        console.log('Method 3: Using Node.js script');
        console.log('   1. Get connection string from Supabase Dashboard → Settings → Database');
        console.log('   2. Run: node run_schema.js "your_connection_string"');
        console.log('');
        
        // Try to use the Supabase Management API if available
        // This requires the project ref and an access token
        const projectRef = config.supabaseUrl.match(/https?:\/\/([^.]+)\.supabase\.co/)?.[1];
        
        if (projectRef) {
            console.log(`📋 Detected Supabase project: ${projectRef}`);
            console.log('💡 You can also use the Supabase CLI:');
            console.log(`   supabase db push --db-url "your_connection_string"`);
        }
        
        process.exit(1);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

runSchema();

