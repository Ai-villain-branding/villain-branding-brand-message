const OpenAI = require('openai');

class AIExtractor {
    constructor(apiKey) {
        this.openai = new OpenAI({
            apiKey: apiKey || process.env.OPENAI_API_KEY
        });

        this.messageCategories = {
            positioning_statement: { min: 10, max: 25 },
            value_proposition: { min: 8, max: 20 },
            tagline: { min: 3, max: 10 },
            differentiator: { min: 5, max: 15 },
            trust_signal: { min: 3, max: 12 },
            feature_description: { min: 5, max: 20 },
            benefit_statement: { min: 5, max: 18 },
            capability_claim: { min: 4, max: 15 }
        };
    }

    // Create extraction prompt
    createExtractionPrompt(content) {
        return `You are a brand messaging expert. Analyze the following website content and extract EXACT brand messages.

IMPORTANT RULES:
1. Extract ONLY exact text from the content - do not paraphrase or modify
2. Each message must be a complete, standalone phrase
3. Respect word count limits for each category
4. Focus on customer-facing messaging, not internal jargon
5. Return ONLY valid JSON, no additional text

CATEGORIES AND WORD LIMITS:
- positioning_statement: 10-25 words (how the brand positions itself in the market)
- value_proposition: 8-20 words (core value offered to customers)
- tagline: 3-10 words (memorable brand phrase or slogan)
- differentiator: 5-15 words (what makes the brand unique)
- trust_signal: 3-12 words (credibility indicators like awards, customers, stats)
- feature_description: 5-20 words (specific product/service features)
- benefit_statement: 5-18 words (customer benefits and outcomes)
- capability_claim: 4-15 words (what the product/service can do)

CONTENT TO ANALYZE:
${JSON.stringify(content, null, 2)}

Return a JSON array of messages in this exact format:
[
  {
    "text": "exact message text from content",
    "category": "category_name",
    "context": "surrounding context or location"
  }
]`;
    }

    // Extract messages from a single page
    async extractFromPage(extractedContent) {
        try {
            // Prepare content for AI
            const contentForAI = {
                url: extractedContent.url,
                title: extractedContent.metadata.title,
                description: extractedContent.metadata.description,
                h1Tags: extractedContent.metadata.h1,
                textBlocks: extractedContent.textBlocks
                    .sort((a, b) => b.weight - a.weight)
                    .slice(0, 30) // Limit to top 30 blocks
                    .map(block => ({
                        text: block.text,
                        type: block.type
                    }))
            };

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4-turbo-preview',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a brand messaging expert that extracts exact brand messages from website content. Always return valid JSON.'
                    },
                    {
                        role: 'user',
                        content: this.createExtractionPrompt(contentForAI)
                    }
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' }
            });

            const result = JSON.parse(response.choices[0].message.content);
            const messages = Array.isArray(result) ? result : (result.messages || []);

            // Validate and filter messages
            return messages
                .filter(msg => this.validateMessage(msg))
                .map(msg => ({
                    ...msg,
                    url: extractedContent.url,
                    wordCount: msg.text.split(/\s+/).length
                }));

        } catch (error) {
            console.error(`Error extracting messages from ${extractedContent.url}:`, error.message);
            return [];
        }
    }

    // Validate message against category rules
    validateMessage(message) {
        if (!message.text || !message.category) return false;

        const category = this.messageCategories[message.category];
        if (!category) return false;

        const wordCount = message.text.split(/\s+/).length;
        return wordCount >= category.min && wordCount <= category.max;
    }

    // Extract messages from multiple pages
    async extractFromPages(extractedContents, onProgress) {
        const allMessages = [];

        for (let i = 0; i < extractedContents.length; i++) {
            const content = extractedContents[i];

            if (onProgress) {
                onProgress({
                    current: i + 1,
                    total: extractedContents.length,
                    url: content.url
                });
            }

            const messages = await this.extractFromPage(content);
            allMessages.push(...messages);

            // Small delay to avoid rate limits
            if (i < extractedContents.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return allMessages;
    }

    // Deduplicate and aggregate messages
    deduplicateMessages(messages) {
        const messageMap = new Map();

        messages.forEach(msg => {
            const key = msg.text.toLowerCase().trim();

            if (messageMap.has(key)) {
                const existing = messageMap.get(key);
                existing.frequency += 1;
                if (!existing.urls.includes(msg.url)) {
                    existing.urls.push(msg.url);
                }
            } else {
                messageMap.set(key, {
                    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    text: msg.text,
                    category: msg.category,
                    wordCount: msg.wordCount,
                    frequency: 1,
                    urls: [msg.url],
                    context: msg.context || ''
                });
            }
        });

        return Array.from(messageMap.values())
            .sort((a, b) => b.frequency - a.frequency);
    }

    // Main analysis function
    async analyzeContent(extractedContents, onProgress) {
        // Extract messages from all pages
        const rawMessages = await this.extractFromPages(extractedContents, onProgress);

        // Deduplicate and aggregate
        const dedupedMessages = this.deduplicateMessages(rawMessages);

        // Calculate category counts
        const categoryCounts = {};
        dedupedMessages.forEach(msg => {
            categoryCounts[msg.category] = (categoryCounts[msg.category] || 0) + 1;
        });

        return {
            messages: dedupedMessages,
            totalMessages: dedupedMessages.length,
            categoryCounts: categoryCounts,
            analyzedAt: new Date().toISOString()
        };
    }
}

module.exports = AIExtractor;
