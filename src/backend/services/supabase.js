
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error('Supabase URL and Service Role Key are required.');
    // We don't throw here to allow the app to start, but services relying on Supabase will fail.
}

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);

module.exports = supabase;
