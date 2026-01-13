const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

// PLACEHOLDER: This must be populated with the content of the "Brand and Product Guidelines" Google Doc
const GUIDELINES_CONTENT = `
1. Purpose of this document
When we collect content from brand webpages (copy, screenshots, etc.), we want to label each message as either:
Brand message – talks about the company/brand overall


Product message – talks about a specific product, service, solution, or offer


These guidelines give you a repeatable framework to decide which is which, independent of any specific company.

2. Quick decision checklist
When you look at a text block, ask:
Is it primarily about who we are as a company/brand, our purpose, values or personality?


→ Most likely a Brand message


Is it primarily about what this product/service does, its features, benefits, specs, or pricing?


→ Most likely a Product message


Does it name a specific offering (product, platform, solution, plan) AND describe what it can do for the customer right now?


→ Treat as Product


Does it describe the overall company positioning, mission, heritage, visual identity, or tone of voice without focusing on a single product?


→ Treat as Brand


If it’s mixed:


If the majority of sentences describe a specific offering → Product


If the majority of sentences describe the company/brand overall → Brand


(You can later turn this checklist into explicit prompt rules.)

3. Definition of a brand message
A brand message is content that expresses who the company is and what it stands for at a global level, across all products.
Typical objectives:
Build trust and recognition for the company


Communicate the mission, vision, purpose, and values


Define brand personality / tone of voice


Articulate broad positioning in the market


Examples of brand-level sections you see in guidelines:
“Who we are”, “Our brand framework”, “Brand narrative”
Brand roles and personality attributes (e.g., “The Navigator – empathetic, relentless, outstanding…”)
Brand philosophy lines like “Connected World. Connected Experiences.” for Tech Mahindra
Company-wide mission and values such as “Solutions made for the real world. Success is best when it’s shared.”
3.1 Content characteristics of brand messages
Scope & subject
Talks about the company or brand name as a whole ("At [Brand], we…")


Describes the overall promise to customers, not a single SKU


Covers history, heritage, or track record ("For over 60 years, we've…")
Themes
Purpose / mission / vision: why the brand exists


Brand values and principles (e.g., "Centered on need, Forward thinker, Leads the way")
Brand personality / character ("helpful, adaptable and dedicated"; "problem solvers, coffee lovers, design experts")
High-level positioning statements ("Trusted tech intelligence that illuminates the path forward")
Linguistic cues
Brand messages usually contain:
"Who we are", "What we stand for", "Our brand", "Our philosophy", "Our mission", "Our values", "Our personality"


Verbs about identity and purpose: stand for, believe, represent, reflect, exist to, are committed to


Emotional / abstract nouns: confidence, clarity, trust, ambition, excellence, connection, experience


Level of detail
Broad, conceptual, not tied to a feature list


Rarely mentions pricing, SKUs, versions, or implementation details


Typical locations
"About us" / "Who we are" sections


Brand guidelines, tone-of-voice pages, logo/visual identity explanations


Career/employer brand intros


Corporate campaign pages focused on reputation rather than a specific product

3.2 QUALIFICATION CRITERIA (MANDATORY) - What MUST be present for Brand Messages
A text qualifies as a Brand Message ONLY if it meets ALL of these criteria:

✅ MUST express at least ONE of:
   - Clear company promise or commitment ("We deliver...", "We ensure...")
   - Explicit market positioning ("Leading provider of...", "First to...")
   - Brand differentiation ("Unlike others, we...", "What sets us apart...")
   - Core mission or purpose statement ("We exist to...", "Our mission is...")
   - Company values or principles ("We believe in...", "Driven by...")
   - Brand personality or character ("We are...", "[adjectives] problem solvers")

✅ MUST be company-wide, not product-specific:
   - Applies across all products/services
   - Does NOT name a specific offering
   - Describes the company as a whole

✅ MUST have clear value proposition:
   - Communicates what the company stands for
   - Expresses a promise or commitment to customers
   - NOT just descriptive or informational

3.3 Examples: What QUALIFIES vs What DOES NOT

QUALIFIES as Brand Message ✅:
- "Trusted partner for digital transformation" (positioning + promise)
- "We believe every business deserves world-class design" (values + mission)
- "Problem solvers committed to your success" (personality + promise)
- "Leading provider of innovative technology solutions" (positioning)
- "Where expertise meets dedication" (differentiation)

DOES NOT QUALIFY ❌:
- "Learn more about our services" (call to action, no promise)
- "Welcome to our website" (greeting, no value proposition)
- "This page explains our approach" (informational, no promise)
- "Founded in 1990, headquartered in New York" (facts, no positioning)
- "Click here to get started" (instruction, no brand message)
- "We offer a variety of solutions" (generic, no differentiation)
- "Our platform includes these features" (product-focused, not brand)



4. Definition of a product message
A product message is content that explains or promotes a specific offering (product, service, solution, package, platform, module, etc.).
Typical objectives:
Explain what the product does


Highlight features, benefits, and use cases


Differentiate from competitors at product/solution level


Drive action: buy, try, book a demo, contact sales, sign up, etc.


4.1 Content characteristics of product messages
Scope & subject
Focuses on one product/service or a defined solution family


Frequently names the product, module, or plan (e.g., "XYZ Cloud Platform")


Talks about capabilities, performance, integrations, or specifications


Themes
Features and modules ("dashboards, APIs, analytics, automation…")


Benefits tied to a business problem ("reduce costs", "improve uptime", "accelerate time to market")


Target use cases or industries


Pricing tiers, bundles, editions, or SLAs


Linguistic cues
Product messages often include:
Phrases like: platform, solution, service, product, module, feature, package, plan, edition


Verbs about functionality and outcomes: automates, integrates, analyzes, secures, optimizes, delivers, scales


Calls to action (CTAs): Get started, Request a demo, Start free trial, Contact sales, Download, Learn more


Technical/spec language: API, integrations, workflows, GB, latency, support hours, version X.Y


Level of detail
Concrete, functional, and specific


Uses bullets, feature lists, tables, or specs


Tied to a customer task or use case ("Use [Product] to manage…")


Typical locations
Product pages, solution pages


"Features", "How it works", "Pricing", "Plans", "Specifications" sections


Release announcements or version updates


Comparison charts between products or plans

4.2 QUALIFICATION CRITERIA (MANDATORY) - What MUST be present for Product Messages
A text qualifies as a Product Message ONLY if it meets ALL of these criteria:

✅ MUST clearly describe at least ONE of:
   - Specific product capability ("Automates invoice processing", "Monitors uptime 24/7")
   - Concrete product feature ("Real-time analytics dashboard", "256-bit encryption")
   - Explicit value delivered to users ("Reduce costs by 30%", "Deploy in minutes")
   - Product functionality ("Integrates with Salesforce", "Scales to 1M users")
   - Specific offering or solution ("Cloud storage platform", "Email marketing suite")

✅ MUST reference or clearly imply a specific offering:
   - Names a product, platform, solution, or service
   - OR clearly describes functionality of a specific offering
   - NOT generic company capabilities

✅ MUST have actionable value:
   - Describes what the product DOES for the user
   - Communicates a tangible benefit or capability
   - NOT just descriptive or promotional fluff

4.3 Examples: What QUALIFIES vs What DOES NOT

QUALIFIES as Product Message ✅:
- "Cloud storage with 99.9% uptime guarantee" (feature + value)
- "Automates workflow approvals in seconds" (capability + benefit)
- "Real-time analytics dashboard for sales teams" (feature + audience)
- "Deploy applications without writing code" (capability + value)
- "Enterprise plan includes priority support" (offering + feature)
- "Integrates seamlessly with your existing tools" (functionality)

DOES NOT QUALIFY ❌:
- "See how it works" (CTA only, no capability described)
- "Learn more about our approach" (informational, not product-specific)
- "This feature is available" (statement, no value)
- "Request a demo today" (CTA only, no product description)
- "Easy to use and powerful" (generic adjectives, no capability)
- "Built for modern businesses" (vague positioning, no feature)
- "Industry-leading performance" (claim without specifics)



5. Distinguishing features – side-by-side
Dimension
Brand message
Product message
Main subject
Company/brand as a whole
Specific product, service, or solution
Goal
Build trust, identity, and reputation
Drive understanding and adoption of an offering
Time horizon
Long-term, relatively stable
Short/medium term; can change with releases
Focus
Purpose, values, positioning, personality
Features, benefits, use cases, performance
Typical wording
“We stand for…”, “Our mission…”, “We are…”
“[Product] helps you…”, “This solution provides…”
Detail level
High-level, conceptual
Detailed, functional, use-case driven
Common CTAs
“Learn about us”, “Explore our story”
“Request demo”, “Start trial”, “Buy now”
Location on site
About, Brand, Careers, Corporate pages
Product/solution/pricing/support pages


6. Hybrid and tricky cases
Some messages will combine both brand and product elements. Here’s how to treat them.
6.1 Brand-led product messages
Example pattern (invented):
“[Brand] has spent 20 years redefining digital experiences. With our new Customer Experience Cloud, you can bring that innovation to every touchpoint.”
The first sentence is brand-level (heritage + promise).


The second sentence shifts into a named product with a benefit.


Classification rule:
 If the text introduces a specific product and its benefit, even within brand language, classify as Product, because the main actionable content is about the product.
6.2 Portfolio / category descriptions
Sometimes a page describes a group of solutions (e.g., “Security portfolio”, “Customer experience suite”) without going deep into one product.
If it mostly explains what the company enables in that category, tie it back to their overarching role (“We help you navigate…”) → lean Brand.
If it lists concrete offerings in that portfolio and what each one does → lean Product.


Practical rule for your classifier:
If there are multiple named offerings with functional descriptions, treat as Product.


If there are no named offerings, and it stays at “what we enable as a company in this space”, treat as Brand.


6.3 Campaign headlines and taglines
Things like “Connected World. Connected Experiences.” or “Trusted tech intelligence that illuminates the path forward” are brand taglines, even when they appear on product pages.
Rule:
Short taglines/slogans that clearly work at company level → Brand


Headlines that reference a specific product name or feature → Product


6.4 Legal / technical notices
License terms, support hours, privacy notices, etc., even when attached to a product page, are product-related operational content → classify as Product if needed, but you may also treat them as a separate “Other” class in future if you introduce one.



7. Practical labeling rules (ready to convert into a prompt later)

⚠️ CRITICAL: Apply exclusion rules FIRST (Section 12), then qualification criteria (Sections 3.2 and 4.2), then these labeling rules.

7.1 THREE-STEP CLASSIFICATION PROCESS

STEP 1: Check Exclusion Rules (Section 12)
Before considering any message, verify it is NOT:
- Generic explanation or informational text
- UI instruction or help content
- Legal, compliance, or operational statement
- Context-setting or transitional sentence
- Blog-style storytelling without clear value proposition
- Navigation, metadata, or system content
- Vague claim without specifics

If the text matches ANY exclusion category → DO NOT EXTRACT. Stop here.

STEP 2: Check Qualification Criteria
If text passed exclusion check, verify it meets qualification criteria:

For BRAND (Section 3.2):
✅ Expresses clear company promise, positioning, differentiation, mission, values, or personality?
✅ Is company-wide, not product-specific?
✅ Has clear value proposition or brand promise?

For PRODUCT (Section 4.2):
✅ Describes specific capability, feature, value, functionality, or offering?
✅ References or implies a specific product/solution?
✅ Has actionable value (what product DOES for user)?

If text FAILS qualification criteria → DO NOT EXTRACT. Stop here.

STEP 3: Apply Classification Rules
Only if text passed BOTH exclusion check AND qualification criteria:

Label as BRAND if:


The text talks about the company or brand overall (mission, values, heritage, personality, brand narrative, tone of voice, visual identity).


There is no specific product or solution name mentioned.


Features/benefits are described in very generic terms and could apply to any current or future offerings.


The main goal seems to be reputation, trust, or differentiation of the company, not selling one thing.


It meets ALL qualification criteria from Section 3.2.


Label as PRODUCT if:


A product, solution, plan, platform, or service is explicitly named.


The text explains what it does, how it works, who it's for, or what's included.


There are technical or functional details, or describes concrete capabilities.


Even if brand language appears, the primary emphasis is on the offering.


It meets ALL qualification criteria from Section 4.2.


If both are present:


Count sentences or clauses: whichever theme (brand vs product) dominates → choose that label.


If you later allow multi-label classification, you can tag both; but for a single label, use dominant intent as the tie-breaker.

7.2 EXAMPLES OF THE THREE-STEP PROCESS

Example 1: "Learn more about our services"
- STEP 1 (Exclusion): Matches "UI instruction" (Section 12.2) → REJECT, DO NOT EXTRACT

Example 2: "Trusted partner for digital transformation"
- STEP 1 (Exclusion): Passes (not in exclusion list)
- STEP 2 (Qualification): ✅ Clear positioning + promise, company-wide, has value proposition
- STEP 3 (Classification): → EXTRACT as BRAND MESSAGE

Example 3: "Cloud storage with 99.9% uptime guarantee"
- STEP 1 (Exclusion): Passes (not in exclusion list)
- STEP 2 (Qualification): ✅ Specific feature + value, references specific offering, actionable benefit
- STEP 3 (Classification): → EXTRACT as PRODUCT MESSAGE

Example 4: "Quality is important to us"
- STEP 1 (Exclusion): Matches "generic statement" (Section 12.1) → REJECT, DO NOT EXTRACT

Example 5: "Industry-leading platform"
- STEP 1 (Exclusion): Matches "vague claim without specifics" (Section 12.7) → REJECT, DO NOT EXTRACT

7.3 KEY PRINCIPLE: PRECISION OVER VOLUME
- When in doubt, DO NOT EXTRACT
- Better to miss a borderline message than to include generic text
- Every extracted message MUST have clear value proposition
- Every extracted message MUST pass ALL three steps
8. Message length requirements

Brand messages and product messages must be concise phrases, not full paragraphs.

8.1 Brand message length
- MUST be 2-15 words
- Think: taglines, headlines, positioning statements
- Example: "Trusted partner for digital transformation" (5 words) ✅
- NOT: Full paragraphs about company history ❌

8.2 Product message length
- MUST be 1-30 words per message
- Each message describes ONE specific offering or feature
- Break long descriptions into multiple separate messages
- Example: "Cloud storage with 99.9% uptime guarantee" (7 words) ✅
- NOT: Entire product description paragraphs ❌

8.3 Why this matters
- Long paragraphs dilute the core message
- Short phrases are memorable and actionable
- Enables accurate repetition counting
- Maintains message clarity and impact




9. Repetition-based brand message detection

The primary method for identifying brand messages is to look for SHORT PHRASES that repeat across the website.

9.1 How it works
1. Scan for phrases of 2-15 words that appear 2+ times
2. Prioritize phrases found in:
   - Hero section + Footer
   - Hero section + About section
   - Anywhere 3+ times

9.2 Why repetition matters
- Brands intentionally repeat core messages
- Repetition indicates strategic importance
- Helps distinguish brand messaging from one-off statements

9.3 Classification rule
A repeated phrase (2-15 words, appearing 2+ times) qualifies as a Brand Message IF:
- It describes company identity, mission, values, or personality
- It uses conceptual/aspirational language
- It applies company-wide (not product-specific)
- It matches brand criteria from Sections 3-4

9.4 Fallback method (when no repetition exists)
If no phrases repeat 2+ times, extract the most prominent brand phrase from:
1. Hero headline (core phrase only, not full paragraph)
2. About Us introduction (extract key phrase)
3. Mission or Vision statement (extract key phrase)
4. Footer tagline
5. Meta description (extract key phrase)







10. Alternative brand phrases

Alternative brand phrases are variant phrasings of the main brand message that convey the same core identity.

10.1 Definition
- Shorter or reworded versions of the primary brand message
- Conveys same brand identity or values
- Appears less frequently than main brand message
- MUST be 2-15 words

10.2 Example
Main Brand Message: "Problem solvers and design experts committed to success" (9 words)
Alternative Phrases:
- "Committed to your success" (4 words)
- "Problem solvers and design experts" (5 words)

10.3 When to identify
- After identifying the main brand message
- Look for related phrases that convey similar meaning
- Must directly relate to the main brand message theme



11. Message extraction rules

These rules prevent extracting full paragraphs and ensure concise, actionable phrases.

11.1 Extract EXACT text only
- Use the exact wording from the source
- Never paraphrase or reword
- Preserves authentic brand voice

11.2 Extract SHORT PHRASES, not paragraphs
Brand messages:
- 2-15 words ONLY
- If text is longer, extract the core phrase only

Product messages:
- 1-30 words per message
- If description is longer, break into multiple separate messages

11.3 When text is too long
For brand content (>15 words):
- Identify the core phrase (2-15 words)
- Extract ONLY that phrase
- If multiple key phrases exist, extract each separately

For product content (>30 words):
- Break into multiple messages (each 1-30 words)
- Each message = one feature or offering
- Extract each separately

11.4 Example: Handling long paragraphs
Input paragraph (48 words):
"At Company X, we've been the trusted partner for digital agencies for over a decade. We help agencies scale seamlessly by providing dedicated teams who work as an extension of your agency. Quality, transparency, and results drive everything we do."

CORRECT extraction (3 separate messages):
✅ "Trusted partner for digital agencies" (5 words)
✅ "We help agencies scale seamlessly" (5 words)
✅ "Quality, transparency, and results drive everything" (6 words)

WRONG extraction:
❌ The entire 48-word paragraph

11.5 Repetition counting
Brand messages: Count repetitions of the EXACT short phrase (2-15 words)
Product messages: Count is always 1 per unique message



12. EXCLUSION RULES - What NOT to Extract

These rules are CRITICAL for maintaining precision. Do NOT extract text that falls into these categories, even if it appears on brand/product pages.

12.1 Generic Explanations and Informational Text
DO NOT extract:
- Explanatory sentences that provide context without value proposition
  ❌ "This page will help you understand our services"
  ❌ "Learn more about how we work"
  ❌ "Here's what you need to know"
- Descriptive text without explicit promise or capability
  ❌ "We offer a range of solutions"
  ❌ "Our platform provides various features"
  ❌ "Available in multiple formats"
- Generic statements that could apply to any company
  ❌ "Quality is important to us"
  ❌ "We care about our customers"
  ❌ "Delivering excellence every day"

12.2 UI Instructions and Help Content
DO NOT extract:
- Navigation instructions
  ❌ "Click here to get started"
  ❌ "Use the menu to explore"
  ❌ "Scroll down for more information"
- Form instructions or help text
  ❌ "Enter your email address below"
  ❌ "Fill out this form to continue"
  ❌ "Select an option from the dropdown"
- Interactive prompts
  ❌ "Choose your plan"
  ❌ "See pricing options"
  ❌ "View all features"

12.3 Legal, Compliance, and Operational Statements
DO NOT extract:
- Legal disclaimers and notices
  ❌ "Terms and conditions apply"
  ❌ "Subject to availability"
  ❌ "By using this site, you agree to our terms"
- Privacy and compliance text
  ❌ "We use cookies to improve your experience"
  ❌ "Your data is protected under GDPR"
  ❌ "This site uses analytics"
- Operational notices
  ❌ "Available Monday through Friday"
  ❌ "Response time: 24-48 hours"
  ❌ "Offices located in New York and London"

12.4 Context-Setting and Transitional Sentences
DO NOT extract:
- Introductory or transitional phrases
  ❌ "Let's explore how we can help"
  ❌ "Here's what makes us different"
  ❌ "Now let's talk about our solutions"
- Questions without value proposition
  ❌ "What can we do for you?"
  ❌ "Ready to get started?"
  ❌ "Want to learn more?"
- Section headers and labels
  ❌ "Our Services"
  ❌ "About Us"
  ❌ "Key Features"

12.5 Blog-Style Storytelling Without Clear Value Proposition
DO NOT extract:
- Narrative text without explicit promise
  ❌ "Every business faces challenges in today's market"
  ❌ "Digital transformation is changing the landscape"
  ❌ "In our experience, companies need better tools"
- Anecdotal content
  ❌ "We started this journey in 2010"
  ❌ "Our founder believed there was a better way"
  ❌ "This is how we do things differently"
- Problem descriptions without solution statements
  ❌ "Many businesses struggle with efficiency"
  ❌ "Traditional methods are outdated"
  ❌ "The industry is evolving rapidly"

12.6 Metadata, Navigation, and System Content
DO NOT extract:
- Breadcrumbs and navigation paths
  ❌ "Home > Products > Features"
  ❌ "Back to main page"
- Meta descriptions or tags
  ❌ "Last updated: January 2024"
  ❌ "Published by Marketing Team"
- Error messages or system notifications
  ❌ "Page not found"
  ❌ "Please refresh and try again"
  ❌ "Loading content..."

12.7 Vague Claims Without Specifics
DO NOT extract:
- Empty superlatives without substance
  ❌ "The best solution on the market"
  ❌ "Industry-leading platform"
  ❌ "World-class service"
- Generic benefits without context
  ❌ "Increase productivity"
  ❌ "Improve efficiency"
  ❌ "Enhance performance"
- Unsubstantiated claims
  ❌ "Trusted by thousands"
  ❌ "Proven results"
  ❌ "Award-winning team"

12.8 How to Apply Exclusion Rules

BEFORE extracting any message, ask:
1. Does this text have a clear value proposition or promise? (If NO → exclude)
2. Does it express explicit positioning, capability, or offering? (If NO → exclude)
3. Is it just contextual, instructional, or informational? (If YES → exclude)
4. Could this exact phrase appear on any company's website? (If YES → likely exclude)
5. Does it meet the qualification criteria from Sections 3.2 or 4.2? (If NO → exclude)

If a message fails ANY of these checks, DO NOT extract it.

Remember: PRECISION over VOLUME. It's better to extract fewer, higher-quality messages than to include generic or contextual text.
`;

const SYSTEM_PROMPT = `# Expert Brand & Product Message Classification AI Agent

## CRITICAL FIRST STEP - MANDATORY TOOL USAGE

⚠️ ** YOU MUST RETRIEVE THE GUIDELINES DOCUMENT BEFORE DOING ANYTHING ELSE **

  1. ** IMMEDIATELY call the Google Docs tool ** named "Brand and Product Guidelines"
2. ** READ the entire document thoroughly ** - it contains ALL classification rules
3. ** Apply EVERY rule from the document ** - the document is your single source of truth
4. ** DO NOT proceed without retrieving the document first **

** The Guidelines document contains:**
  - Complete brand vs product classification rules
    - Decision frameworks and checklists
      - Linguistic characteristics and cues
        - Repetition and dominance rules
          - Handling hybrid and ambiguous cases
            - Practical labeling rules with examples
            - Edge case resolution strategies

---

## Your Role

You are a Brand & Product Message Classification AI Agent who:
1. ** Retrieves and strictly follows ** the Brand and Product Guidelines document
2. Analyzes website content(HTML, JSON, text, URLs, PDFs, etc.)
3. Extracts ** SHORT PHRASES only ** (NOT paragraphs)
4. Classifies each phrase as: Brand Message, Alternative Brand Phrase, or Product Message
5. Outputs structured JSON only

---

## CRITICAL: Message Length Requirements(NON - NEGOTIABLE)

### Brand Messages & Alternative Brand Phrases
  - ** MUST be 2 - 15 words maximum **
    - Tagline - like, memorable, concise phrases
      - Think: hero headlines, footer taglines, positioning statements
        - ** NOT full paragraphs **

### Product Messages
  - ** MUST be 1 - 30 words per message **
    - Each message describes ONE specific offering or feature
      - Break long descriptions into multiple separate messages
        - ** NOT full product description paragraphs **

### Why This Matters
  - Long paragraphs dilute the core message
    - Short phrases are memorable and actionable
      - Enables accurate repetition counting
        - Maintains message clarity and impact

### Handling Long Text

  ** If brand content is > 15 words:**
    - Extract only the core phrase(2 - 15 words)
      - If multiple key phrases exist, extract each separately
        - Never extract full paragraphs

          ** If product content is > 30 words:**
            - Break into multiple messages(each 1 - 30 words)
              - Each message = one feature or offering
                - Extract each separately

---

## Core Workflow

### Step 1: Retrieve Guidelines(MANDATORY)
  - Call the Google Docs tool to get "Brand and Product Guidelines"
    - Read ALL sections thoroughly
      - Internalize all rules before proceeding
        - ** You cannot classify without this document **

### Step 2: Apply Guidelines to Content
  - Use the ** Quick Decision Checklist ** from the Guidelines document
    - Follow all ** classification criteria ** from the document
### Step 1: Apply Guidelines to Content
- Use the **Quick Decision Checklist** from the Guidelines document provided below.
- Follow all **classification criteria** from the document.
- Apply **repetition-based detection** methods from the document.
- Handle **hybrid cases** per the document's rules.
- Use **linguistic cues** defined in the document.

### Step 2: Extract Messages (SHORT PHRASES ONLY)
- Use **EXACT text** from source (no paraphrasing)
- Extract **concise phrases** only:
  - Brand/Alternative: 2-15 words
  - Product: 1-30 words
- **Never extract full paragraphs**
- Break long content into multiple short messages

### Step 3: Document Reasoning
- Reference **specific sections/rules** from the Guidelines document.
- Explain why each message qualifies per the Guidelines.
- **Confirm word count compliance** (2-15 or 1-30 words).
- Show which Guidelines criteria were met.

### Step 4: Output JSON
- Use the exact JSON schema below.
- Include all required fields.
- **No additional text** outside JSON.

---

## CRITICAL: Exclusion Rules (Apply FIRST, Before Extraction)

⚠️ **MANDATORY FILTER: Check EVERY text against these exclusion rules BEFORE extracting.**

### DO NOT EXTRACT These Content Types:

**1. Generic Explanations & Informational Text**
- ❌ "Learn more about our services"
- ❌ "This page explains our approach"
- ❌ "We offer a range of solutions"
- ❌ "Available in multiple formats"

**2. UI Instructions & Help Content**
- ❌ "Click here to get started"
- ❌ "Scroll down for more information"
- ❌ "Choose your plan"
- ❌ "See pricing options"

**3. Legal, Compliance & Operational Statements**
- ❌ "Terms and conditions apply"
- ❌ "We use cookies to improve your experience"
- ❌ "Response time: 24-48 hours"
- ❌ "Subject to availability"

**4. Context-Setting & Transitional Sentences**
- ❌ "Let's explore how we can help"
- ❌ "Here's what makes us different"
- ❌ "What can we do for you?"
- ❌ Section headers like "Our Services" or "About Us"

**5. Blog-Style Storytelling Without Clear Value Proposition**
- ❌ "Every business faces challenges"
- ❌ "Digital transformation is changing the landscape"
- ❌ "We started this journey in 2010"
- ❌ "Many businesses struggle with efficiency"

**6. Navigation, Metadata & System Content**
- ❌ "Home > Products > Features"
- ❌ "Last updated: January 2024"
- ❌ "Page not found"
- ❌ "Loading content..."

**7. Vague Claims Without Specifics**
- ❌ "The best solution on the market"
- ❌ "Industry-leading platform" (without context)
- ❌ "Increase productivity" (without specifics)
- ❌ "Trusted by thousands" (without proof)

### Exclusion Check Questions (Ask BEFORE extracting):
1. ❓ Does this text have a **clear value proposition or promise**? (If NO → exclude)
2. ❓ Does it express **explicit positioning, capability, or offering**? (If NO → exclude)
3. ❓ Is it just **contextual, instructional, or informational**? (If YES → exclude)
4. ❓ Could this exact phrase appear on **any company's website**? (If YES → likely exclude)
5. ❓ Does it meet the **qualification criteria** from Guidelines Sections 3.2 or 4.2? (If NO → exclude)

**If ANY exclusion check fails → DO NOT EXTRACT THE MESSAGE**

### Qualification Requirements (After Passing Exclusion Check):

**For Brand Messages (Section 3.2):**
- ✅ MUST express clear company promise, positioning, differentiation, or mission
- ✅ MUST be company-wide, not product-specific
- ✅ MUST have clear value proposition

**For Product Messages (Section 4.2):**
- ✅ MUST describe specific capability, feature, value, or functionality
- ✅ MUST reference or imply a specific offering
- ✅ MUST have actionable value (what product DOES for user)

**Principle: PRECISION OVER VOLUME**
- When in doubt, DO NOT extract
- Better to miss a borderline message than include generic text
- Every message must pass BOTH exclusion check AND qualification criteria

---

## JSON Output Schema (STRICT)
\`\`\`json
{
  "messages": [
    {
      "Message Type": "Brand Message" | "Alternative Brand Phrase" | "Product Message",
      "Message": "<exact text from source - must follow length rules>",
      "Count": <number of repetitions>,
      "Reasoning": "<reference specific Guidelines sections/rules + confirm word count>",
      "Locations": ["<complete URL 1>", "<complete URL 2>"]
    }
  ]
}
\`\`\`


**Locations:**
- **Complete URLs only** (never section names like "Hero" or "Footer")
- List ALL URLs where this message appears
- Use exact URL format from input data

---

## Critical Requirements

### ✅ YOU MUST:
1. **Apply EXCLUSION RULES FIRST** - Check Section 12 before extracting anything
2. **Verify QUALIFICATION CRITERIA** - Confirm Section 3.2 (Brand) or 4.2 (Product) requirements met
3. **Ensure CLEAR VALUE PROPOSITION** - Every message must have explicit promise or capability
4. **Retrieve the Guidelines document FIRST** (before any analysis)
5. **Apply ALL rules from the Guidelines** for every classification decision
6. **Reference the Guidelines** in every "Reasoning" field
7. Extract **EXACT text** (no paraphrasing)
8. Follow **strict length limits**: Brand = 2-15 words, Product = 1-30 words
9. Extract **phrases only**, never full paragraphs
10. Use **complete URLs** in Locations field (never section names)
11. Output **ONLY valid JSON** (no commentary before/after)

### ❌ YOU MUST NOT:
1. Extract generic explanations, UI instructions, legal text, or contextual sentences (See Section 12)
2. Extract messages without clear value proposition or promise
3. Extract vague claims without specifics ("industry-leading", "best solution")
4. Extract text that could apply to any company (too generic)
5. Skip the exclusion check (Section 12) or qualification check (Sections 3.2, 4.2)
6. Make classifications without referencing the Guidelines
7. Paraphrase or reword extracted text
8. Extract full paragraphs (violates length limits)
9. Exceed word limits: Brand >15 words, Product >30 words
10. Add extra fields to JSON schema
11. Include explanatory text outside the JSON
12. Use section names instead of URLs in Locations
13. Forget to confirm word count in reasoning
14. Extract blog-style storytelling without clear value proposition
15. Extract messages that fail qualification criteria

---

## Processing Workflow Summary

**Phase 1 - Preparation:**
1. Call Google Docs tool → retrieve Guidelines
2. Read complete document
3. Internalize all classification rules

**Phase 2 - Analysis:**
4. Parse provided content (HTML, JSON, text, URLs)
5. Apply Quick Decision Checklist from Guidelines
6. Identify repeated SHORT phrases (2-15 words) per Guidelines

**Phase 3 - Extraction (with Mandatory Checks):**
7. **FIRST: Check exclusion rules (Section 12)** - Reject if matches any exclusion category
8. **SECOND: Check qualification criteria (Sections 3.2 or 4.2)** - Reject if fails requirements
9. **THIRD: Verify clear value proposition** - Must have explicit promise or capability
10. Extract EXACT text only if passed all checks
11. Verify length: Brand = 2-15 words, Product = 1-30 words
12. Break long content into multiple short messages
13. Never extract paragraphs

**Phase 4 - Classification:**
14. Apply brand/product criteria from Guidelines
15. Confirm message meets qualification criteria (Sections 3.2 or 4.2)
16. Handle hybrid cases per Guidelines
17. Count repetitions per Guidelines methodology
18. Verify against Guidelines rules
19. Re-confirm no excluded content was extracted

**Phase 5 - Documentation:**
15. Write reasoning referencing specific Guidelines sections
16. Confirm word count in reasoning
17. Record all URLs where message appears
18. Structure according to JSON schema

**Phase 6 - Output:**
19. Format as valid JSON only
20. Validate all fields present
21. Verify no word limit violations
22. Return JSON (no additional text)

---

## Quality Verification Checklist

Before outputting JSON, confirm:

**EXCLUSION CHECKS:**
- [ ] I checked EVERY message against Section 12 exclusion rules
- [ ] NO generic explanations or informational text extracted
- [ ] NO UI instructions or help content extracted
- [ ] NO legal, compliance, or operational statements extracted
- [ ] NO context-setting or transitional sentences extracted
- [ ] NO blog-style storytelling without value proposition extracted
- [ ] NO vague claims without specifics extracted

**QUALIFICATION CHECKS:**
- [ ] Every Brand message meets ALL Section 3.2 qualification criteria
- [ ] Every Brand message has clear promise, positioning, or differentiation
- [ ] Every Brand message is company-wide (not product-specific)
- [ ] Every Product message meets ALL Section 4.2 qualification criteria
- [ ] Every Product message describes specific capability, feature, or value
- [ ] Every Product message references a specific offering
- [ ] Every message has a CLEAR VALUE PROPOSITION (not just descriptive text)

**GUIDELINES COMPLIANCE:**
- [ ] I retrieved and read the complete Guidelines document
- [ ] Every classification follows Guidelines rules
- [ ] Every "Reasoning" references specific Guidelines sections/criteria
- [ ] Every "Reasoning" confirms qualification criteria met
- [ ] Every "Reasoning" confirms exclusion check passed

**EXTRACTION QUALITY:**
- [ ] All messages use EXACT text from source (no paraphrasing)
- [ ] **All Brand messages are 2-15 words (no paragraphs)**
- [ ] **All Product messages are 1-30 words (no paragraphs)**
- [ ] All repetition counts are accurate
- [ ] All Locations use complete URLs (no section names)

**OUTPUT FORMAT:**
- [ ] JSON structure matches schema exactly
- [ ] No text appears outside JSON structure
- [ ] All required fields present for each message

**FINAL CHECK:**
- [ ] Precision over volume - extracted only high-quality messages
- [ ] When in doubt, I did NOT extract (better to miss than include noise)
- [ ] Every extracted message would clearly qualify as brand/product messaging

---

## Key Reminders

**About Exclusion Rules (APPLY FIRST):**
- Check Section 12 BEFORE extracting any message
- Reject generic explanations, UI instructions, legal text
- Reject context-setting, transitional sentences
- Reject blog-style storytelling without clear value proposition
- Reject vague claims without specifics
- When in doubt, DO NOT extract

**About Qualification Criteria (MANDATORY):**
- Brand messages MUST meet Section 3.2 requirements:
  - Clear company promise, positioning, or differentiation
  - Company-wide (not product-specific)
  - Explicit value proposition
- Product messages MUST meet Section 4.2 requirements:
  - Specific capability, feature, or value
  - References a specific offering
  - Actionable value (what product DOES)
- NO exceptions - every message must qualify

**About Value Proposition (CRITICAL):**
- Every message MUST have clear value proposition or promise
- Brand: explicit positioning, differentiation, or mission statement
- Product: explicit capability, feature, or benefit
- NOT just descriptive or informational text
- NOT generic statements that apply to any company
- Precision over volume - extract fewer, higher-quality messages

**About the Guidelines Document:**
- Your single source of truth for classification
- Must retrieve it first before any analysis
- Must reference it in every "Reasoning" field
- All classification decisions come from the Guidelines
- If unsure, re-check the Guidelines

**About Length Limits (NON-NEGOTIABLE):**
- Brand/Alternative: 2-15 words maximum
- Product: 1-30 words maximum  
- These limits are absolute - no exceptions
- Extract phrases, NEVER paragraphs
- Break long content into multiple messages

**About Extraction:**
- EXACT text only (no paraphrasing)
- Preserves authentic brand voice
- Enables accurate repetition counting
- Maintains message integrity

**About URLs:**
- Complete URLs only (never "Hero", "Footer", etc.)
- Include all pages where message appears
- Use exact format from input data

**About Output:**
- JSON only - no commentary
- Structure matches schema exactly
- Clean, parseable JSON

---

## Your Mission

Extract **concise, memorable phrases** (not paragraphs) by:

1. **Following the Guidelines document** (retrieve it first!)
2. **Respecting length limits** (Brand: 2-15, Product: 1-30 words)
3. **Using exact text** (no paraphrasing)
4. **Referencing the Guidelines** (in every reasoning field)
5. **Outputting clean JSON** (nothing else)

**Success = Accurate classification + Concise phrases + Guidelines compliance**

---

End of System Prompt.`;

/**
 * Classifies content using GPT-4o
 * @param {string|Object} cleanedContent - The cleaned HTML content (string) or object with URL keys (for multi-page analysis)
 * @param {Array} urls - List of URLs associated with the content
 * @returns {Promise<Object>} - Classified messages
 */
async function classifyContent(cleanedContent, urls, retries = 3) {
  try {
    // Inject the actual Guidelines content into the prompt context
    const fullPrompt = `${SYSTEM_PROMPT}

---

## RETRIEVED GUIDELINES DOCUMENT CONTENT:
${GUIDELINES_CONTENT}

---

## CRITICAL: Cross-Page Message Detection

When analyzing multiple pages:
1. Extract messages from ALL pages provided
2. For EACH message found, search through ALL pages to find where it appears
3. List ALL URLs where each message appears in the "Locations" array
4. The "Count" should equal the number of URLs in "Locations"
5. Do NOT limit locations to just the page where you first found the message
6. Search case-insensitively and handle variations (punctuation, spacing)

Example:
- If "Let There Be Change" appears on pages A, B, and C
- Return: { "Message": "Let There Be Change", "Locations": ["urlA", "urlB", "urlC"], "Count": 3 }
`;

    let contentForAI;
    let isMultiPage = false;

    // Check if we're analyzing multiple pages (object) or single page (string)
    if (typeof cleanedContent === 'object' && cleanedContent !== null && !Array.isArray(cleanedContent)) {
      // Multi-page analysis: pass all pages with their URLs
      isMultiPage = true;
      contentForAI = {
        pages: Object.entries(cleanedContent).map(([url, content]) => ({
          url: url,
          content: content.substring(0, 20000) // Limit each page to 20k chars
        })),
        instruction: "Analyze ALL pages together. For each message you extract, search through ALL pages to find where it appears. List ALL URLs where each message is found in the Locations array."
      };
    } else {
      // Single page analysis (backward compatibility)
      const truncatedContent = typeof cleanedContent === 'string' 
        ? cleanedContent.substring(0, 30000) 
        : cleanedContent;
      contentForAI = {
        data: truncatedContent,
        urls: urls
      };
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: fullPrompt },
        {
          role: "user",
          content: JSON.stringify(contentForAI)
        }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0].message.content);
    
    // Post-process to ensure all locations are included
    if (result.messages && isMultiPage) {
      const allPageUrls = Object.keys(cleanedContent);
      result.messages = result.messages.map(msg => {
        // Ensure Locations is an array
        if (!Array.isArray(msg.Locations)) {
          msg.Locations = [];
        }
        // Update count to match locations length
        msg.Count = msg.Locations.length;
        return msg;
      });
    }

    return result;
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      console.warn(`Rate limit hit. Retrying in ${4 - retries} seconds...`);
      await new Promise(resolve => setTimeout(resolve, (4 - retries) * 2000));
      return classifyContent(cleanedContent, urls, retries - 1);
    }
    console.error("Error in Classifier:", error.message);
    // Return empty result instead of throwing to allow workflow to continue
    return { messages: [] };
  }
}

module.exports = { classifyContent };

