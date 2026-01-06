require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please set these in your Railway environment variables or .env file');
    // Don't exit in production, but log warning
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
}

module.exports = {
    openaiApiKey: process.env.OPENAI_API_KEY,
    port: process.env.PORT || 3000,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    googleDriveClientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    googleDriveClientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    googleDriveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    scrappeyApiKey: process.env.SCRAPPEY_API_KEY
};
