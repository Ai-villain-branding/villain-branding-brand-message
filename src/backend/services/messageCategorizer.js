const OpenAI = require('openai');
const config = require('../config');
const supabase = require('./supabase');

const openai = new OpenAI({
    apiKey: config.openaiApiKey,
});

/**
 * Main entry point for categorizing messages
 * @param {string} companyId - The company UUID
 * @param {Array} messages - Array of message objects with id, content, message_type
 * @returns {Promise<Object>} - Categorized result with categories array
 */
async function categorizeMessages(companyId, messages) {
    try {
        console.log(`[Categorizer] Starting categorization for company ${companyId} with ${messages.length} messages`);

        if (!messages || messages.length === 0) {
            console.log('[Categorizer] No messages to categorize');
            return { categories: [] };
        }

        // Generate prompt
        const prompt = generateCategoriesPrompt(messages);
        console.log(`[Categorizer] Generated prompt (${prompt.length} chars)`);

        // Call OpenAI
        const aiResponse = await callOpenAIForCategorization(prompt);
        console.log('[Categorizer] Received AI response');

        // Validate and normalize
        const validated = await validateAndNormalizeCategories(aiResponse, messages.map(m => m.id));
        console.log(`[Categorizer] Validated ${validated.categories.length} categories`);

        // Persist to database
        const result = await persistCategories(companyId, validated.categories);
        console.log(`[Categorizer] Persisted ${result.categories.length} categories`);

        return result;
    } catch (error) {
        console.error('[Categorizer] Error in categorizeMessages:', error.message);
        throw error;
    }
}

/**
 * Generates the prompt for OpenAI to categorize messages
 * @param {Array} messages - Array of message objects
 * @returns {string} - Formatted prompt string
 */
function generateCategoriesPrompt(messages) {
    const messagesList = messages.map((msg, index) => {
        return `${index + 1}. [ID: ${msg.id}] [Type: ${msg.message_type}]
   Content: "${msg.content}"
   ${msg.reasoning ? `Reasoning: ${msg.reasoning}` : ''}`;
    }).join('\n\n');

    const allMessageIds = messages.map(m => m.id).join(', ');

    return `You are a brand messaging expert. Your task is to analyze ALL the following brand messages together and group them into simple, theme-based semantic categories.

═══════════════════════════════════════════════════════════════
STRICT REQUIREMENTS - FOLLOW THESE EXACTLY:
═══════════════════════════════════════════════════════════════

STEP 1: ANALYZE ALL MESSAGES TOGETHER
- Read through ALL messages first to identify common themes
- Look for semantic patterns: what topics, concepts, or themes appear across multiple messages?
- Identify the PRIMARY theme of each message (e.g., "change", "innovation", "trust", "growth", "service", "quality")
- Group messages that share the SAME core semantic theme

STEP 2: CATEGORY GENERATION
- Generate 3-8 category names that represent BROADER, THEME-BASED categories
- Category names can be 1-3 words - use what best captures the broader theme
- Single words are fine for simple themes (e.g., "Change", "Innovation", "Trust", "Growth")
- 2-3 word phrases are fine for broader, more descriptive themes (e.g., "Digital Transformation", "Customer Success", "Service Excellence", "Market Leadership")
- Use Title Case format (capitalize first letter of each word)
- Each category name should represent a BROADER semantic theme that groups 2+ related messages together
- Categories should be descriptive enough to clearly represent what the grouped messages are about
- DO NOT use generic placeholders like "Other", "Misc", "General", or "Various"
- Focus on THEMES, not business concepts - think about what the messages are TALKING ABOUT

STEP 3: MESSAGE MAPPING (CRITICAL)
- You MUST assign EVERY message ID to exactly ONE category
- NO message ID can be omitted
- NO message ID can appear in multiple categories
- Each category MUST contain at least 2 messages
- Group messages by their PRIMARY semantic theme - if a message talks about "change", put it in "Change" category

STEP 4: VALIDATION CHECKLIST
Before returning your response, verify:
✓ Every message ID from the list below appears in exactly one category
✓ All ${messages.length} message IDs are accounted for
✓ Each category has at least 2 message IDs
✓ All category names are theme-based (1-3 words, broader descriptive themes are fine)
✓ All category names are unique
✓ JSON format is valid and matches the required structure exactly

═══════════════════════════════════════════════════════════════
CATEGORY NAMING EXAMPLES (Broader Theme-Based Categories):
═══════════════════════════════════════════════════════════════
Single Word Examples (Simple Themes):
✓ "Change" - messages talking about transformation, change, evolution
✓ "Innovation" - messages about innovation, new ideas, cutting-edge
✓ "Trust" - messages building trust, credibility, reliability
✓ "Growth" - messages about growth, success, potential, expansion
✓ "Service" - messages about service offerings, service quality
✓ "Quality" - messages emphasizing quality, excellence, standards

2-3 Word Examples (Broader Descriptive Themes):
✓ "Digital Transformation" - messages about digitalization, technology transformation
✓ "Customer Success" - messages about customer outcomes, benefits, satisfaction
✓ "Service Excellence" - messages about superior service quality and delivery
✓ "Market Leadership" - messages about industry leadership, market position
✓ "Innovation Culture" - messages about fostering innovation and creativity
✓ "Trust Building" - messages focused on building credibility and trust
✓ "Growth Strategy" - messages about growth plans, expansion, scaling
✓ "Partnership Approach" - messages about collaboration and partnerships

✗ INVALID: "Service Offerings" (too generic, business concept not theme)
✗ INVALID: "Brand Positioning Statements" (too long, business concept)
✗ INVALID: "The Complete Guide to Understanding Our Value Proposition Statement" (too long, >3 words)
✗ INVALID: "Other Messages" (generic placeholder)
✗ INVALID: "Miscellaneous Content" (generic placeholder)

Remember: Use broader, descriptive category names (1-3 words) that clearly represent the theme shared by the grouped messages.

═══════════════════════════════════════════════════════════════
MESSAGES TO CATEGORIZE (Total: ${messages.length} messages):
═══════════════════════════════════════════════════════════════
${messagesList}

═══════════════════════════════════════════════════════════════
REQUIRED JSON FORMAT (STRICT):
═══════════════════════════════════════════════════════════════
You MUST return ONLY valid JSON in this EXACT format:

{
  "categories": [
    {
      "name": "Small Relevant Phrase",
      "description": "Brief explanation of what this category represents",
      "message_ids": ["uuid1", "uuid2", "uuid3"]
    },
    {
      "name": "Another Category Phrase",
      "description": "Brief explanation",
      "message_ids": ["uuid4", "uuid5"]
    }
  ]
}

═══════════════════════════════════════════════════════════════
FINAL VALIDATION:
═══════════════════════════════════════════════════════════════
ALL MESSAGE IDs THAT MUST BE INCLUDED:
${allMessageIds}

Before submitting, count:
1. Total message IDs in your response: Must equal ${messages.length}
2. Total categories: Must be between 3-8
3. Messages per category: Each must have ≥2 message IDs
4. Category name word count: 1-3 words (broader descriptive themes are fine)

Your response will be automatically validated. If any message ID is missing, duplicated, or incorrectly formatted, the response will be rejected.

REMEMBER: Think about what the messages are TALKING ABOUT. Group messages that share the same broader theme. Use descriptive category names (1-3 words) that clearly represent what the grouped messages are about. For example:
- If multiple messages discuss "change" or "transformation", group them under "Change" or "Digital Transformation" (depending on context)
- If they discuss "innovation" or "new technology", group them under "Innovation" or "Innovation Culture"
- Use broader, more descriptive names when it helps clarify the theme!`;
}

/**
 * Calls OpenAI API for categorization
 * @param {string} prompt - The prompt to send
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<Object>} - Parsed JSON response
 */
async function callOpenAIForCategorization(prompt, retries = 3) {
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a brand messaging categorization expert. Your role is to analyze ALL brand messages together and group them into simple, theme-based semantic categories.

CRITICAL SYSTEM REQUIREMENTS:
1. You MUST return ONLY valid JSON - no additional text, explanations, or markdown formatting
2. Every message ID provided in the input MUST appear in exactly ONE category's message_ids array
3. NO message ID can be omitted, duplicated, or placed in multiple categories
4. Category names MUST be broader theme-based names: 1-3 words (e.g., "Change", "Innovation", "Digital Transformation", "Service Excellence")
5. Each category MUST contain at least 2 message IDs
6. You MUST generate 3-8 categories total
7. Category names must be unique and represent clear semantic themes (what messages are talking about)
8. Your response will be programmatically validated - any deviation will cause failure

ANALYSIS APPROACH:
- First, read ALL messages to identify common themes
- Group messages that share the SAME broader semantic theme
- Think about what the messages are TALKING ABOUT, not business concepts
- Use broader, descriptive category names (1-3 words) that clearly represent the theme
- If messages discuss "change" or "transformation", use "Change" or "Digital Transformation" (depending on context)
- If messages discuss "innovation" or "new technology", use "Innovation" or "Innovation Culture"
- Use more descriptive names when they help clarify the broader theme

VALIDATION RULES YOU MUST FOLLOW:
- Count all message IDs in your response - must match the input count exactly
- Verify each message ID appears exactly once across all categories
- Ensure all category names are theme-based (1-3 words, broader descriptive themes are fine)
- Ensure each category has at least 2 message IDs
- Use only valid JSON syntax - no markdown code blocks, no comments
- Category names should represent themes, not business concepts

Your response format must be:
{
  "categories": [
    {
      "name": "Change",
      "description": "Messages about transformation and change",
      "message_ids": ["id1", "id2", "id3"]
    }
  ]
}

Remember: Completeness and accuracy of message ID mapping is MANDATORY. Missing or duplicate IDs will cause your response to be rejected. Focus on BROADER, THEME-BASED categories (1-3 words) that clearly represent what the grouped messages are about.`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        });

        const responseText = completion.choices[0].message.content;
        const parsed = JSON.parse(responseText);

        return parsed;
    } catch (error) {
        if (error.status === 429 && retries > 0) {
            console.warn(`[Categorizer] Rate limit hit. Retrying in ${4 - retries} seconds...`);
            await new Promise(resolve => setTimeout(resolve, (4 - retries) * 2000));
            return callOpenAIForCategorization(prompt, retries - 1);
        }

        if (error.message.includes('JSON') && retries > 0) {
            console.warn(`[Categorizer] JSON parse error. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return callOpenAIForCategorization(prompt, retries - 1);
        }

        console.error('[Categorizer] OpenAI API error:', error.message);
        throw new Error(`OpenAI API failed: ${error.message}`);
    }
}

/**
 * Validates and normalizes the AI response
 * @param {Object} aiResponse - Raw AI response
 * @param {Array<string>} expectedMessageIds - Array of expected message IDs
 * @returns {Promise<Object>} - Validated and normalized structure
 */
async function validateAndNormalizeCategories(aiResponse, expectedMessageIds) {
    // Validate structure
    if (!aiResponse || !aiResponse.categories || !Array.isArray(aiResponse.categories)) {
        throw new Error('Invalid AI response: missing categories array');
    }

    const categories = aiResponse.categories;
    const normalizedCategories = [];
    const allAssignedMessageIds = new Set();
    const categoryNameMap = new Map(); // For deduplication

    // Validate each category
    for (const cat of categories) {
        if (!cat.name || !cat.message_ids || !Array.isArray(cat.message_ids)) {
            console.warn('[Categorizer] Skipping invalid category:', cat);
            continue;
        }

        // Normalize category name
        const normalizedName = normalizeCategoryName(cat.name);
        if (!normalizedName || normalizedName.length === 0) {
            console.warn('[Categorizer] Skipping category with invalid name:', cat.name);
            continue;
        }

        // Filter valid message IDs
        const validMessageIds = cat.message_ids.filter(id => {
            if (!expectedMessageIds.includes(id)) {
                console.warn(`[Categorizer] Message ID ${id} not found in expected list`);
                return false;
            }
            if (allAssignedMessageIds.has(id)) {
                console.warn(`[Categorizer] Message ID ${id} already assigned to another category`);
                return false;
            }
            return true;
        });

        // Minimum 2 messages per category
        if (validMessageIds.length < 2) {
            console.warn(`[Categorizer] Category "${normalizedName}" has less than 2 messages, skipping`);
            continue;
        }

        // Check for duplicate category names (similarity)
        const existingCategory = findSimilarCategory(normalizedName, categoryNameMap);
        if (existingCategory) {
            // Merge with existing category
            console.log(`[Categorizer] Merging similar categories: "${normalizedName}" into "${existingCategory.name}"`);
            existingCategory.message_ids = [...new Set([...existingCategory.message_ids, ...validMessageIds])];
            validMessageIds.forEach(id => allAssignedMessageIds.add(id));
        } else {
            // Add new category
            const categoryObj = {
                name: normalizedName,
                description: cat.description || '',
                message_ids: validMessageIds
            };
            normalizedCategories.push(categoryObj);
            categoryNameMap.set(normalizedName.toLowerCase(), categoryObj);
            validMessageIds.forEach(id => allAssignedMessageIds.add(id));
        }
    }

    // Check if all messages are assigned
    const unassignedIds = expectedMessageIds.filter(id => !allAssignedMessageIds.has(id));
    if (unassignedIds.length > 0) {
        console.warn(`[Categorizer] ${unassignedIds.length} messages were not assigned to any category`);
        // Create an "Other" category for unassigned messages if there are enough
        if (unassignedIds.length >= 2) {
            normalizedCategories.push({
                name: 'Other',
                description: 'Messages that did not fit into other categories',
                message_ids: unassignedIds
            });
        }
    }

    return {
        categories: normalizedCategories
    };
}

/**
 * Normalizes a category name
 * @param {string} name - Raw category name
 * @returns {string} - Normalized name
 */
function normalizeCategoryName(name) {
    if (!name || typeof name !== 'string') return '';

    // Trim whitespace
    let normalized = name.trim();

    // Remove special characters (keep alphanumeric, spaces, hyphens)
    normalized = normalized.replace(/[^\w\s-]/g, '');

    // Capitalize first letter of each word
    normalized = normalized.split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');

    // Enforce simple theme-based naming (prefer single words, max 3 words)
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 3) {
        // Take first 3 words if more than 3 (prefer shorter names)
        normalized = words.slice(0, 3).join(' ');
        console.log(`[Categorizer] Truncated category name to 3 words: "${normalized}"`);
    }
    // Single words are now allowed and preferred

    // Limit total length (allow for longer phrases)
    if (normalized.length > 80) {
        normalized = normalized.substring(0, 80).trim();
    }

    return normalized;
}

/**
 * Finds a similar category name using string similarity
 * @param {string} name - Category name to check
 * @param {Map} categoryMap - Map of existing categories
 * @returns {Object|null} - Similar category or null
 */
function findSimilarCategory(name, categoryMap) {
    const nameLower = name.toLowerCase();
    
    // Exact match
    if (categoryMap.has(nameLower)) {
        return categoryMap.get(nameLower);
    }

    // Check similarity (Levenshtein distance)
    for (const [existingName, category] of categoryMap.entries()) {
        const similarity = calculateSimilarity(nameLower, existingName);
        if (similarity > 0.8) {
            return category;
        }
    }

    return null;
}

/**
 * Calculates string similarity (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score (0-1)
 */
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    // Simple word-based similarity
    const words1 = new Set(longer.split(/\s+/));
    const words2 = new Set(shorter.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

/**
 * Persists categories and updates messages with category_id
 * @param {string} companyId - Company UUID
 * @param {Array} categories - Array of category objects with message_ids
 * @returns {Promise<Object>} - Persisted result
 */
async function persistCategories(companyId, categories) {
    try {
        // Delete existing categories for this company (regeneration strategy: replace)
        console.log(`[Categorizer] Deleting existing categories for company ${companyId}`);
        const { error: deleteError } = await supabase
            .from('message_categories')
            .delete()
            .eq('company_id', companyId);

        if (deleteError) {
            console.error('[Categorizer] Error deleting old categories:', deleteError);
            throw deleteError;
        }

        if (categories.length === 0) {
            console.log('[Categorizer] No categories to persist');
            return { categories: [] };
        }

        // Insert new categories
        const categoryInserts = categories.map(cat => ({
            company_id: companyId,
            name: cat.name,
            description: cat.description || '',
            message_count: cat.message_ids.length,
            updated_at: new Date().toISOString()
        }));

        console.log(`[Categorizer] Inserting ${categoryInserts.length} categories`);
        const { data: insertedCategories, error: insertError } = await supabase
            .from('message_categories')
            .insert(categoryInserts)
            .select();

        if (insertError) {
            console.error('[Categorizer] Error inserting categories:', insertError);
            throw insertError;
        }

        // Update messages with category_id directly
        console.log(`[Categorizer] Updating messages with category_id...`);
        for (const insertedCat of insertedCategories) {
            // Find the original category to get message_ids
            const originalCat = categories.find(c => c.name === insertedCat.name);
            if (originalCat && originalCat.message_ids.length > 0) {
                const { error: updateError } = await supabase
                    .from('brand_messages')
                    .update({ category_id: insertedCat.id })
                    .in('id', originalCat.message_ids);

                if (updateError) {
                    console.error(`[Categorizer] Error updating messages for category ${insertedCat.name}:`, updateError);
                    // Continue with other categories even if one fails
                } else {
                    console.log(`[Categorizer] Updated ${originalCat.message_ids.length} messages with category_id: ${insertedCat.id}`);
                }
            }
        }

        // Return structured result
        return {
            categories: insertedCategories.map(cat => ({
                id: cat.id,
                name: cat.name,
                description: cat.description,
                message_count: cat.message_count
            }))
        };
    } catch (error) {
        console.error('[Categorizer] Error persisting categories:', error);
        throw error;
    }
}

module.exports = {
    categorizeMessages
};

