const supabase = require('./services/supabase');

async function createBucket() {
    try {
        console.log("Checking 'screenshots' bucket...");
        const { data, error } = await supabase.storage.getBucket('screenshots');

        if (error && error.message.includes('not found')) {
            console.log("Bucket 'screenshots' not found. Creating...");
            const { data: newBucket, error: createError } = await supabase.storage.createBucket('screenshots', {
                public: true,
                fileSizeLimit: 5242880, // 5MB
                allowedMimeTypes: ['image/png', 'image/jpeg']
            });

            if (createError) {
                console.error('Error creating bucket:', createError);
            } else {
                console.log("Bucket 'screenshots' created successfully.");
            }
        } else if (error) {
            console.error('Error checking bucket:', error);
        } else {
            console.log("Bucket 'screenshots' already exists.");
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

createBucket();
