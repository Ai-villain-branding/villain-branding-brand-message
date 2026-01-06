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

    return `You are a brand messaging expert. Your task is to analyze the following brand messages and group them into high-level, generalized semantic categories.

═══════════════════════════════════════════════════════════════
STRICT REQUIREMENTS - FOLLOW THESE EXACTLY:
═══════════════════════════════════════════════════════════════

STEP 1: CATEGORY GENERATION
- Generate 3-8 category names that represent BROAD, GENERALIZED themes
- Category names MUST be small, relevant phrases (2-5 words maximum)
- Use Title Case format (e.g., "Value Proposition", "Building Trust Signals", "Product Feature Highlights")
- Each category name must be a meaningful business concept phrase
- DO NOT use generic placeholders like "Other", "Misc", "General", or "Various"
- Focus on HIGHEST-LEVEL semantic themes, not surface-level keywords
- Keep phrases concise but descriptive - they should capture the essence clearly

STEP 2: MESSAGE MAPPING (CRITICAL)
- You MUST assign EVERY message ID to exactly ONE category
- NO message ID can be omitted
- NO message ID can appear in multiple categories
- Each category MUST contain at least 2 messages
- Group messages by their PRIMARY semantic theme (highest conceptual level)

STEP 3: VALIDATION CHECKLIST
Before returning your response, verify:
✓ Every message ID from the list below appears in exactly one category
✓ All ${messages.length} message IDs are accounted for
✓ Each category has at least 2 message IDs
✓ All category names are small, relevant phrases (2-5 words)
✓ All category names are unique
✓ JSON format is valid and matches the required structure exactly

═══════════════════════════════════════════════════════════════
CATEGORY NAMING EXAMPLES (Small Relevant Phrases, Title Case):
═══════════════════════════════════════════════════════════════
✓ "Value Proposition" - messages about core value offered
✓ "Building Trust Signals" - messages building credibility
✓ "Product Feature Highlights" - messages about product capabilities
✓ "Brand Market Positioning" - messages about market position
✓ "Customer Success Benefits" - messages about customer outcomes
✓ "Market Leadership Status" - messages about industry standing
✓ "Brand Identity Elements" - messages about brand essence
✓ "Service Quality Excellence" - messages about service excellence
✓ "Competitive Advantages" - messages about competitive edge
✓ "Customer Testimonials" - messages featuring customer feedback

✗ INVALID: "Value" (too short, single word)
✗ INVALID: "The Complete Guide to Understanding Our Value Proposition Statement" (too long, >5 words)
✗ INVALID: "Other Messages" (generic placeholder)
✗ INVALID: "Miscellaneous Content" (generic placeholder)

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
4. Category name word count: Each must be 2-5 words (small relevant phrases)

Your response will be automatically validated. If any message ID is missing, duplicated, or incorrectly formatted, the response will be rejected.`;
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
                    content: `You are a brand messaging categorization expert. Your role is to analyze brand messages and group them into semantic categories.

CRITICAL SYSTEM REQUIREMENTS:
1. You MUST return ONLY valid JSON - no additional text, explanations, or markdown formatting
2. Every message ID provided in the input MUST appear in exactly ONE category's message_ids array
3. NO message ID can be omitted, duplicated, or placed in multiple categories
4. Category names MUST be small, relevant phrases (2-5 words) in Title Case format
5. Each category MUST contain at least 2 message IDs
6. You MUST generate 3-8 categories total
7. Category names must be unique and represent high-level business concepts as descriptive phrases
8. Your response will be programmatically validated - any deviation will cause failure

VALIDATION RULES YOU MUST FOLLOW:
- Count all message IDs in your response - must match the input count exactly
- Verify each message ID appears exactly once across all categories
- Ensure all category names are small, relevant phrases (2-5 words, no more, no less)
- Ensure each category has at least 2 message IDs
- Use only valid JSON syntax - no markdown code blocks, no comments
- Category names should be meaningful business phrases, not single words or overly long descriptions

Your response format must be:
{
  "categories": [
    {
      "name": "Small Relevant Phrase",
      "description": "Description text",
      "message_ids": ["id1", "id2", "id3"]
    }
  ]
}

Remember: Completeness and accuracy of message ID mapping is MANDATORY. Missing or duplicate IDs will cause your response to be rejected.`
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
                name: 'Other Messages',
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

    // Enforce small phrase limit (2-5 words) for category names
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 5) {
        // Take first 5 words if more than 5
        normalized = words.slice(0, 5).join(' ');
        console.log(`[Categorizer] Truncated category name to 5 words: "${normalized}"`);
    }
    if (words.length < 2) {
        // If less than 2 words, pad or use as-is (will be validated)
        console.warn(`[Categorizer] Category name has less than 2 words: "${normalized}"`);
    }

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

