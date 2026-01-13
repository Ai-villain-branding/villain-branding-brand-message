-- Create Companies Table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  name TEXT,
  analysis_mode TEXT DEFAULT 'full_website', -- 'full_website' or 'specific_pages'
  pages_analyzed INTEGER, -- Number of pages analyzed (null for full website, count for specific pages)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Brand Messages Table
CREATE TABLE IF NOT EXISTS brand_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL, -- 'Brand Message', 'Alternative Brand Phrase', 'Product Message'
  content TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  reasoning TEXT,
  locations TEXT[], -- Array of URLs
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Screenshots Table
CREATE TABLE IF NOT EXISTS screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  message_id UUID REFERENCES brand_messages(id) ON DELETE SET NULL,
  image_url TEXT, -- Can be NULL for failed attempts
  original_url TEXT, -- The page URL where screenshot was taken
  message_content TEXT, -- The text that was highlighted/captured
  status TEXT DEFAULT 'success', -- 'success' or 'failed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenshots ENABLE ROW LEVEL SECURITY;

-- Create Policies (Open for now as we are using Service Role Key on backend, but good practice)
-- Allow read access to everyone (public dashboard)
CREATE POLICY "Allow public read access on companies" ON companies FOR SELECT USING (true);
CREATE POLICY "Allow public read access on brand_messages" ON brand_messages FOR SELECT USING (true);
CREATE POLICY "Allow public read access on screenshots" ON screenshots FOR SELECT USING (true);

-- Allow insert/update/delete only via service role (which bypasses RLS anyway, but explicit is good)
-- Actually, service role bypasses RLS, so we don't strictly need policies for it.
-- But if we ever access from frontend with anon key, we'd need these.
