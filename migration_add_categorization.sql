-- Migration: Add AI-driven message categorization
-- This migration adds support for storing AI-generated categories with direct mapping to messages

-- Create Message Categories Table
CREATE TABLE IF NOT EXISTS message_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, name)
);

-- Add category_id column directly to brand_messages table
ALTER TABLE brand_messages 
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES message_categories(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_message_categories_company_id ON message_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_brand_messages_category_id ON brand_messages(category_id);

-- Enable Row Level Security
ALTER TABLE message_categories ENABLE ROW LEVEL SECURITY;

-- Create Policies (Open for now as we are using Service Role Key on backend)
CREATE POLICY "Allow public read access on message_categories" ON message_categories FOR SELECT USING (true);

