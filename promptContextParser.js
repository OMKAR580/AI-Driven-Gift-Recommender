/**
 * Structured request helpers for recommendation generation.
 * Keeps the backend contract grounded in explicit context + catalog data
 * instead of treating the client-built prompt as the source of truth.
 */

const ALLOWED_RESPONSE_IMAGES = [
  '/candle_mock.png',
  '/desk_mat_mock.png',
  '/elegant_perfume.png',
  '/headphones_mock.png',
  '/luxury_watch.png',
  '/matte_watch.png',
  '/minimal_desk.png',
  '/modern_coffee_mug.png',
  '/sleek_wallet.png',
  '/smart_ring_mock.png',
  '/zen_garden.png',
];

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function lineAfter(prompt, label) {
  const idx = String(prompt || '').indexOf(label);
  if (idx < 0) {
    return null;
  }
  const rest = String(prompt || '').slice(idx + label.length).trimStart();
  const nl = rest.indexOf('\n');
  const line = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
  return line || null;
}

function sanitizeText(value, fallback = '', maxLength = 240) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return fallback;
  }
  return trimmed.slice(0, maxLength);
}

function uniqueStrings(values, maxLength = 40) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(
    values
      .map((value) => sanitizeText(String(value ?? ''), '', maxLength))
      .filter(Boolean),
  )];
}

function sanitizeUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : '';
}

function sanitizeMarketplaceLinks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((acc, [platform, url]) => {
    const sanitized = sanitizeUrl(url);
    if (sanitized) {
      acc[String(platform).trim().toLowerCase()] = sanitized;
    }
    return acc;
  }, {});
}

function sanitizeMarketplacePrices(value, validLinks) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((acc, [platform, price]) => {
    const key = String(platform).trim().toLowerCase();
    const numeric = Number.parseInt(price, 10);
    if (validLinks[key] && Number.isFinite(numeric) && numeric > 0) {
      acc[key] = numeric;
    }
    return acc;
  }, {});
}

export function parseCatalogFromPrompt(prompt) {
  const label = 'Candidate catalog:';
  const line = lineAfter(prompt, label);
  if (!line) {
    return [];
  }
  const parsed = safeJsonParse(line);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseIntentContextFromPrompt(prompt) {
  const profileLine = lineAfter(prompt, 'Recipient profile:');
  const rawProfile = profileLine && /^"(.*)"$/.test(profileLine)
    ? profileLine.replace(/^"|"$/g, '')
    : profileLine?.replace(/^"|"$/g, '') || '';

  const recipientType = (lineAfter(prompt, 'Recipient type:') || '')
    .replace(/^"|"$/g, '')
    .trim();

  const activeChipLabel = (lineAfter(prompt, 'Selected recipient chip:') || '')
    .replace(/^"|"$/g, '')
    .trim();

  const selectedOccasionLabel = (lineAfter(prompt, 'Selected occasion chip:') || '')
    .replace(/^"|"$/g, '')
    .trim();

  const priceSensitivity = (lineAfter(prompt, 'Price sensitivity:') || '')
    .replace(/^"|"$/g, '')
    .trim();

  const luxuryLine = lineAfter(prompt, 'Luxury selected:');
  const luxurySelected = /^yes$/i.test((luxuryLine || '').trim());

  const confLine = lineAfter(prompt, 'Intent confidence:');
  const confidence = Number.parseFloat(confLine || '');

  const normalizedIntent = safeJsonParse(lineAfter(prompt, 'Normalized intent object:') || 'null') || {};
  const recipientTags = safeJsonParse(lineAfter(prompt, 'Normalized recipient cues:') || '[]') || [];
  const interestTags = safeJsonParse(lineAfter(prompt, 'Normalized interest cues:') || '[]') || [];
  const styleTags = safeJsonParse(lineAfter(prompt, 'Normalized style cues:') || '[]') || [];
  const categoryTags = safeJsonParse(lineAfter(prompt, 'Normalized category cues:') || '[]') || [];
  const avoidTags = safeJsonParse(lineAfter(prompt, 'Avoid tags:') || '[]') || [];
  const intentTags = safeJsonParse(lineAfter(prompt, 'Expanded semantic intent cues:') || '[]') || [];

  return {
    rawProfile,
    recipientType,
    activeChipLabel,
    selectedOccasionLabel,
    priceSensitivity,
    luxurySelected,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    normalizedIntent,
    recipientTags: Array.isArray(recipientTags) ? recipientTags : [],
    interestTags: Array.isArray(interestTags) ? interestTags : [],
    styleTags: Array.isArray(styleTags) ? styleTags : [],
    categoryTags: Array.isArray(categoryTags) ? categoryTags : [],
    avoidTags: Array.isArray(avoidTags) ? avoidTags : [],
    intentTags: Array.isArray(intentTags) ? intentTags : [],
  };
}

function normalizeCandidateItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const id = sanitizeText(item.id, '', 80);
  const title = sanitizeText(item.title, '', 120);
  const type = item.type === 'verified' ? 'verified' : 'concept';

  if (!id || !title) {
    return null;
  }

  const marketplaceLinks = type === 'verified'
    ? sanitizeMarketplaceLinks(item.marketplaceLinks)
    : {};
  const marketplacePrices = type === 'verified'
    ? sanitizeMarketplacePrices(item.marketplacePrices, marketplaceLinks)
    : {};
  const fallbackSearchTerm = sanitizeText(`${item.brand || ''} ${title}`, title, 180);

  return {
    id,
    type,
    title,
    brand: sanitizeText(item.brand, '', 80),
    category: sanitizeText(item.category, type === 'verified' ? 'Gift' : 'Gift idea', 80),
    description: sanitizeText(item.description || item.desc, '', 320),
    image: sanitizeText(item.image || item.img, '', 200),
    imageTags: uniqueStrings(item.imageTags),
    searchTerm: sanitizeText(item.searchTerm, fallbackSearchTerm, 180),
    imageSearchQuery: sanitizeText(item.imageSearchQuery, title, 180),
    validationStatus: type,
    tags: uniqueStrings(item.tags),
    recipientTags: uniqueStrings(item.recipientTags),
    interestTags: uniqueStrings(item.interestTags),
    occasionTags: uniqueStrings(item.occasionTags),
    styleTags: uniqueStrings(item.styleTags),
    marketplaceLinks,
    marketplacePrices,
  };
}

// Role and interest mapping constants for better relevance
const RECIPIENT_ROLE_PATTERNS = {
  teacher: ['teacher', 'school', 'professor', 'educator', 'instructor'],
  friend: ['friend', 'buddy', 'pal', 'mate'],
  brother: ['brother', 'sibling', 'bro'],
  mother: ['mother', 'mom', 'mum', 'mommy'],
  father: ['father', 'dad', 'daddy', 'pa'],
  partner: ['partner', 'spouse', 'wife', 'husband', 'girlfriend', 'boyfriend'],
  colleague: ['colleague', 'coworker', 'work', 'office'],
  manager: ['manager', 'boss', 'supervisor'],
  traveler: ['traveler', 'travels', 'wanderer'],
  gamer: ['gamer', 'gaming', 'player'],
  student: ['student', 'college', 'university'],
  artist: ['artist', 'creative', 'designer'],
  reader: ['reader', 'reading', 'bookworm'],
};

const INTEREST_PATTERNS = {
  math: ['math', 'mathematics', 'numbers', 'calculation', 'algebra'],
  gaming: ['gaming', 'games', 'gamer', 'play', 'console'],
  cooking: ['cooking', 'cook', 'kitchen', 'recipe', 'food'],
  coffee: ['coffee', 'caffeine', 'espresso', 'brew'],
  reading: ['reading', 'books', 'literature', 'novel'],
  fitness: ['fitness', 'gym', 'workout', 'exercise'],
  travel: ['travel', 'traveling', 'trip', 'vacation'],
  music: ['music', 'songs', 'audio', 'melody'],
  stationery: ['stationery', 'writing', 'pen', 'paper', 'notebook'],
  tech: ['tech', 'technology', 'gadget', 'electronic'],
  decor: ['decor', 'decoration', 'home', 'interior'],
  art: ['art', 'artistic', 'creative', 'painting'],
  productivity: ['productivity', 'organize', 'planner', 'efficient'],
  plants: ['plants', 'gardening', 'green', 'nature'],
};

const GIFT_TONE_PATTERNS = {
  practical: ['practical', 'useful', 'functional'],
  premium: ['premium', 'luxury', 'high-end', 'quality'],
  sentimental: ['sentimental', 'meaningful', 'emotional'],
  playful: ['playful', 'fun', 'quirky'],
  academic: ['academic', 'educational', 'learning'],
  creative: ['creative', 'artistic', 'unique'],
  minimalist: ['minimalist', 'simple', 'clean'],
  luxury: ['luxury', 'expensive', 'lavish'],
};

function extractRecipientRole(text) {
  const lower = text.toLowerCase();
  for (const [role, patterns] of Object.entries(RECIPIENT_ROLE_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return role;
      }
    }
  }
  return 'unknown';
}

function extractInterests(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const [interest, patterns] of Object.entries(INTEREST_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        found.add(interest);
        break;
      }
    }
  }
  return Array.from(found);
}

function extractGiftTone(text) {
  const lower = text.toLowerCase();
  for (const [tone, patterns] of Object.entries(GIFT_TONE_PATTERNS)) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) {
        return tone;
      }
    }
  }
  return 'neutral';
}

function extractAvoidCategories(text) {
  const lower = text.toLowerCase();
  const avoid = new Set();
  
  // Explicit avoid patterns
  if (lower.includes('no coffee') || lower.includes('avoid coffee') || lower.includes('not coffee')) {
    avoid.add('coffee');
  }
  if (lower.includes('no mugs') || lower.includes('avoid mugs')) {
    avoid.add('mugs');
  }
  if (lower.includes('no candles') || lower.includes('avoid candles')) {
    avoid.add('candles');
  }
  
  return Array.from(avoid);
}

export function normalizeRecommendationContext(input) {
  if (typeof input === 'string') {
    return normalizeRecommendationContext(parseIntentContextFromPrompt(input));
  }

  const ctx = input && typeof input === 'object' ? input : {};
  
  // Extract enhanced context from raw profile text
  const rawProfile = sanitizeText(ctx.rawProfile, 'someone thoughtful', 400);
  const recipientRole = extractRecipientRole(rawProfile);
  const interests = extractInterests(rawProfile);
  const giftTone = extractGiftTone(rawProfile);
  const avoidCategories = extractAvoidCategories(rawProfile);
  
  // User text should dominate over active chips when they conflict
  const finalRecipientType = recipientRole !== 'unknown' ? recipientRole : sanitizeText(ctx.recipientType, 'unknown', 60);
  const finalInterests = interests.length > 0 ? interests : uniqueStrings(ctx.interestTags);

  return {
    rawProfile,
    recipientType: finalRecipientType,
    activeChipLabel: sanitizeText(ctx.activeChipLabel, '', 80),
    selectedOccasionLabel: sanitizeText(ctx.selectedOccasionLabel, '', 80),
    priceSensitivity: sanitizeText(ctx.priceSensitivity, 'balanced', 40),
    luxurySelected: Boolean(ctx.luxurySelected),
    confidence: Number.isFinite(Number(ctx.confidence)) ? Number(ctx.confidence) : 0.5,
    normalizedIntent: ctx.normalizedIntent && typeof ctx.normalizedIntent === 'object' ? ctx.normalizedIntent : {},
    recipientTags: uniqueStrings(ctx.recipientTags),
    interestTags: finalInterests,
    styleTags: uniqueStrings(ctx.styleTags),
    categoryTags: uniqueStrings(ctx.categoryTags),
    avoidTags: [...uniqueStrings(ctx.avoidTags), ...avoidCategories],
    intentTags: uniqueStrings(ctx.intentTags),
    // Enhanced extracted context
    extractedRecipientRole: recipientRole,
    extractedInterests: interests,
    extractedGiftTone: giftTone,
    extractedAvoidCategories: avoidCategories,
  };
}

export function normalizeCandidateCatalog(input) {
  const rawCatalog = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? parseCatalogFromPrompt(input)
      : [];

  return rawCatalog
    .map(normalizeCandidateItem)
    .filter(Boolean);
}

export function buildRecommendationRequestPrompt({ context, catalog }) {
  const normalizedContext = normalizeRecommendationContext(context);
  const normalizedCatalog = normalizeCandidateCatalog(catalog);

  const catalogPreview = normalizedCatalog.map((product) => ({
    id: product.id,
    type: product.type,
    title: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    image: product.image,
    imageTags: product.imageTags,
    searchTerm: product.searchTerm,
    validationStatus: product.validationStatus,
    tags: product.tags,
    recipientTags: product.recipientTags,
    interestTags: product.interestTags,
    occasionTags: product.occasionTags,
    styleTags: product.styleTags,
  }));

  return [
    // Enhanced prompt instructions for better relevance
    'You are selecting or designing gift recommendations for GiftAI Atelier.',
    'Return JSON only with this exact shape:',
    '{"recommendations":[{"id":"catalog-id-or-slug","type":"verified|concept","title":"Gift name","brand":"Brand if known","description":"one sentence description","reason":"short recipient-specific reason","category":"Category","searchTerm":"literal product or concept search phrase","validationStatus":"verified|concept","imageSearchQuery":"literal image search phrase","tags":["relevant","ranking","tags"]}]}',
    'CRITICAL RELEVANCE RULES:',
    '- RECIPIENT ROLE DOMINATES: teacher→desk/stationery/reading/practical, math lover→puzzles/logic/books, gamer→gaming accessories, cooking→kitchen/tools, reader→books/reading accessories',
    '- EXPLICIT INTERESTS SECOND: match stated interests (math, gaming, cooking, coffee) with relevant gift categories',
    '- AVOID GENERIC REPETITION: do not return multiple mugs/coffee items unless coffee is explicitly mentioned',
    '- BAD FIT PENALTIES: teacher should not get random gaming gadgets; math lover should not get generic mugs; gamer should not get candles/decor unless specified',
    '- DIVERSE CATEGORIES: ensure 4-6 recommendations cover different gift types, not variations of same item',
    '- COFFEE ONLY WHEN EXPLICIT: only prioritize coffee gifts when coffee is explicitly mentioned in the profile',
    'Rules:',
    '- Choose 4 to 6 unique recommendations.',
    '- Use type "verified" only when selecting an exact catalog item by id.',
    '- Use type "concept" for directional ideas that are not exact catalog products.',
    '- For verified picks, preserve the exact catalog id and product identity.',
    '- Do not invent marketplace links, marketplace prices, buy buttons, or live-commerce claims.',
    '- Concept picks must not contain buy links or price claims.',
    '- Important: Always include "imageSearchQuery": for verified picks use brand + exact product + category; for concepts use a mood/concept phrase.',
    `- Important: If you include "image", choose ONE that best fits from this exact list: ${JSON.stringify(ALLOWED_RESPONSE_IMAGES)}`,
    '- Keep reasons short and specific, under 18 words.',
    '- Recipient fit must dominate occasion.',
    '- Luxury is only a modifier.',
    `Recipient profile: "${normalizedContext.rawProfile}"`,
    `Recipient type: "${normalizedContext.recipientType}"`,
    `Selected recipient chip: "${normalizedContext.activeChipLabel || 'none'}"`,
    `Selected occasion chip: "${normalizedContext.selectedOccasionLabel || 'none'}"`,
    `Luxury selected: ${normalizedContext.luxurySelected ? 'yes' : 'no'}`,
    `Price sensitivity: "${normalizedContext.priceSensitivity}"`,
    `Intent confidence: ${normalizedContext.confidence.toFixed(2)}`,
    `Normalized intent object: ${JSON.stringify(normalizedContext.normalizedIntent || {})}`,
    `Normalized recipient cues: ${JSON.stringify(normalizedContext.recipientTags)}`,
    `Normalized interest cues: ${JSON.stringify(normalizedContext.interestTags)}`,
    `Normalized style cues: ${JSON.stringify(normalizedContext.styleTags)}`,
    `Normalized category cues: ${JSON.stringify(normalizedContext.categoryTags)}`,
    `Avoid tags: ${JSON.stringify(normalizedContext.avoidTags)}`,
    `Expanded semantic intent cues: ${JSON.stringify(normalizedContext.intentTags)}`,
    `Candidate catalog: ${JSON.stringify(catalogPreview)}`,
  ].join('\n');
}

export function buildRecommendationCacheKey(input) {
  const context = normalizeRecommendationContext(input?.context ?? input?.prompt ?? input);
  const catalog = normalizeCandidateCatalog(input?.candidates ?? input?.prompt);

  return JSON.stringify({
    context: {
      rawProfile: context.rawProfile.toLowerCase(),
      recipientType: context.recipientType.toLowerCase(),
      activeChipLabel: context.activeChipLabel.toLowerCase(),
      selectedOccasionLabel: context.selectedOccasionLabel.toLowerCase(),
      priceSensitivity: context.priceSensitivity.toLowerCase(),
      luxurySelected: context.luxurySelected,
      confidence: context.confidence.toFixed(2),
      normalizedIntent: context.normalizedIntent,
      recipientTags: [...context.recipientTags].sort(),
      interestTags: [...context.interestTags].sort(),
      styleTags: [...context.styleTags].sort(),
      categoryTags: [...context.categoryTags].sort(),
      avoidTags: [...context.avoidTags].sort(),
      intentTags: [...context.intentTags].sort(),
    },
    catalog: catalog.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      brand: item.brand,
      category: item.category,
      description: item.description,
      image: item.image,
      searchTerm: item.searchTerm,
      imageSearchQuery: item.imageSearchQuery,
      validationStatus: item.validationStatus,
      tags: item.tags,
      recipientTags: item.recipientTags,
      interestTags: item.interestTags,
      occasionTags: item.occasionTags,
      styleTags: item.styleTags,
      marketplaceLinks: Object.fromEntries(Object.entries(item.marketplaceLinks || {}).sort()),
      marketplacePrices: Object.fromEntries(Object.entries(item.marketplacePrices || {}).sort()),
    })),
  });
}
