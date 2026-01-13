require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Get database connection string from environment or command line argument
// Supabase connection string format: postgresql://postgres:[password]@[host]:[port]/postgres
const connectionString = process.argv[2] || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
    console.error('❌ Missing database connection string.');
    console.error('\nUsage: node run_schema.js [connection_string]');
    console.error('   OR set DATABASE_URL or SUPABASE_DB_URL in your .env file');
    console.error('\n💡 To get your Supabase connection string:');
    console.error('   1. Go to your Supabase Dashboard');
    console.error('   2. Navigate to Settings → Database');
    console.error('   3. Copy the "Connection string" (URI format)');
    console.error('   4. Run: node run_schema.js "postgresql://postgres:password@host:port/postgres"');
    console.error('      OR add it to your .env file as DATABASE_URL');
    process.exit(1);
}

async function runSchema() {
    const client = new Client({
        connectionString: connectionString,
        ssl: { rejectUnauthorized: false } // Supabase requires SSL
    });

    try {
        // Read the SQL file
        const sqlPath = path.join(__dirname, '../../database/schema.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('📄 Reading SQL schema file...');
        console.log('🔌 Connecting to database...');

        await client.connect();
        console.log('✅ Connected to database');

        // Execute the entire SQL file
        console.log('🔄 Executing schema...');
        await client.query(sql);

        console.log('\n✅ Schema executed successfully!');
        console.log('📊 Tables created: companies, brand_messages, screenshots');
        console.log('🔒 Row Level Security (RLS) enabled');
        console.log('📝 Policies created for public read access');

    } catch (error) {
        console.error('❌ Error running schema:', error.message);
        if (error.code) {
            console.error(`   Error code: ${error.code}`);
        }
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Database connection closed');
    }
}

runSchema();

