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

    return `You are a brand messaging expert. Analyze the following brand messages and group them into high-level, generalized semantic categories.

CRITICAL RULES:
1. Generate 3-8 category names that represent BROAD, GENERALIZED themes - think at the highest conceptual level
2. Category names MUST be exactly 2 words maximum (e.g., "Value Proposition", "Trust Signals", "Product Features", "Brand Positioning", "Customer Benefits", "Market Leadership")
3. Each category MUST contain at least 2 messages
4. Focus on GENERALIZED themes that capture the core essence - avoid overly specific or narrow categories
5. Category names should be meaningful business concepts, not generic placeholders like "Other" or "Misc"
6. Assign each message to exactly ONE category based on its primary semantic theme
7. Group messages by their HIGHEST-LEVEL meaning - look for the fundamental theme, not surface-level keywords
8. Consider the overall business purpose of messages when categorizing (e.g., "Trust Building", "Value Delivery", "Market Position")
9. Category names should be Title Case, exactly 2 words (e.g., "Brand Identity", "Product Capabilities", "Customer Success")

EXAMPLES OF GOOD GENERALIZED CATEGORIES (2 words):
- "Value Proposition" - messages about core value offered
- "Trust Signals" - messages building credibility
- "Product Features" - messages about product capabilities
- "Brand Positioning" - messages about market position
- "Customer Benefits" - messages about customer outcomes
- "Market Leadership" - messages about industry standing

MESSAGES TO CATEGORIZE:
${messagesList}

Return ONLY valid JSON in this exact format:
{
  "categories": [
    {
      "name": "Two Word Category",
      "description": "Brief explanation of what this category represents",
      "message_ids": ["uuid1", "uuid2", "uuid3"]
    }
  ]
}

IMPORTANT:
- Every message ID must appear in exactly one category
- All message IDs from the list above must be included
- Category names must be unique
- Category names MUST be exactly 2 words (no more, no less)
- Minimum 2 messages per category
- Focus on GENERALIZED, HIGH-LEVEL themes, not specific details`;
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
                    content: 'You are a brand messaging expert that categorizes messages into semantic themes. Always return valid JSON only.'
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

    // Enforce 2-word maximum for category names
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 2) {
        // Take first 2 words if more than 2
        normalized = words.slice(0, 2).join(' ');
        console.log(`[Categorizer] Truncated category name to 2 words: "${normalized}"`);
    }

    // Limit total length
    if (normalized.length > 50) {
        normalized = normalized.substring(0, 50).trim();
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

