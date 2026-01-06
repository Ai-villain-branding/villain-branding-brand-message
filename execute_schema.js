require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gbnysktqhdsdepbfcnsg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdibnlza3RxaGRzZGVwYmZjbnNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjQ3MjEzOSwiZXhwIjoyMDgyMDQ4MTM5fQ.DKzdSz_4lolD6SbbxTEWztdcOJammxL0FWvuQlaITz8';

async function executeSchema() {
    // Get connection string from command line or environment
    const connectionString = process.argv[2] || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    
    if (connectionString) {
        // Use direct PostgreSQL connection
        console.log('📄 Reading SQL schema file...');
        console.log('🔌 Connecting to database...');
        
        const client = new Client({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false }
        });
        
        try {
            await client.connect();
            console.log('✅ Connected to database');
            
            const sqlPath = path.join(__dirname, 'supabase_schema.sql');
            const sql = fs.readFileSync(sqlPath, 'utf8');
            
            console.log('🔄 Executing schema...');
            await client.query(sql);
            
            console.log('\n✅ Schema executed successfully!');
            console.log('📊 Tables created: companies, brand_messages, screenshots');
            console.log('🔒 Row Level Security (RLS) enabled');
            console.log('📝 Policies created for public read access');
            
            await client.end();
            return;
        } catch (error) {
            console.error('❌ Error executing schema:', error.message);
            await client.end();
            process.exit(1);
        }
    }
    
    // If no connection string, try using Supabase client (won't work for DDL, but let's try)
    console.log('⚠️  No database connection string provided.');
    console.log('\n💡 To get your database connection string:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/gbnysktqhdsdepbfcnsg/settings/database');
    console.log('   2. Scroll to "Connection string" section');
    console.log('   3. Copy the "URI" format (looks like: postgresql://postgres.[ref]:[password]@...)');
    console.log('   4. Run: node execute_schema.js "your_connection_string"\n');
    
    console.log('📋 Or use the Supabase Dashboard SQL Editor:');
    console.log('   https://supabase.com/dashboard/project/gbnysktqhdsdepbfcnsg/sql/new\n');
    
    process.exit(1);
}

executeSchema();

