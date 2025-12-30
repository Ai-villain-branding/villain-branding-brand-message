-- Migration: Add analysis_mode and pages_analyzed columns to companies table
-- Run this if you have an existing database

ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS analysis_mode TEXT DEFAULT 'full_website';

ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS pages_analyzed INTEGER;

-- Update existing records to have default value
UPDATE companies 
SET analysis_mode = 'full_website' 
WHERE analysis_mode IS NULL;

