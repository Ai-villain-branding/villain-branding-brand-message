-- Migration: Add status column and make image_url nullable for failed screenshot attempts
-- Run this if you have an existing database

-- Make image_url nullable to allow failed attempts
ALTER TABLE screenshots 
ALTER COLUMN image_url DROP NOT NULL;

-- Add status column to track success/failure
ALTER TABLE screenshots 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';

-- Update existing records to have success status
UPDATE screenshots 
SET status = 'success' 
WHERE status IS NULL AND image_url IS NOT NULL;

-- Set status to failed for any records with null image_url
UPDATE screenshots 
SET status = 'failed' 
WHERE image_url IS NULL;

