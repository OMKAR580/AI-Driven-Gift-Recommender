/**
 * Recommendation orchestration:
 * - structured request normalization
 * - Gemini model execution
 * - explicit fallback handling
 * - response normalization to the backend API contract
 */

import { createHash } from 'node:crypto';
import {
  buildRecommendationCacheKey,
  buildRecommendationRequestPrompt,
  normalizeCandidateCatalog,
  normalizeRecommendationContext,
} from './promptContextParser.js';
import { createTtlCache } from './recommendationCache.js';
import { buildCuratedFallbackRecommendations, FALLBACK_POOL } from './curatedFallbackEngine.js';
import { enhanceMarketplaceLinks } from './marketplaceResolver.js';

const DEFAULT_REC_TTL_MS = Number(process.env.RECOMMENDATION_CACHE_TTL_MS) || 20 * 60 * 1000;
const DEFAULT_MODEL_TTL_MS = Number(process.env.MODEL_RESPONSE_CACHE_TTL_MS) || 15 * 60 * 1000;

const recommendationResultCache = createTtlCache({
  name: 'recommendation',
  defaultTtlMs: DEFAULT_REC_TTL_MS,
  onLog: (a, b) => console.log('[giftai-cache]', a, b ?? ''),
});

const modelResponseResultCache = createTtlCache({
  name: 'modelResponse',
  defaultTtlMs: DEFAULT_MODEL_TTL_MS,
  onLog: (a, b) => console.log('[giftai-cache]', a, b ?? ''),
});

const ALLOWED_IMAGES = new Set([
  '/ai_gift_box.png',
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
]);

const MIN_RECOMMENDATIONS = 4;
const MAX_RECOMMENDATIONS = 6;
const LOW_ITEM_CONFIDENCE = 0.42;
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 22000;
const GROQ_SYSTEM_PROMPT = 'You are GiftAI Atelier, a strict JSON-only gift recommendation engine. Return only valid JSON.';
const DEFAULT_GROQ_MODELS = [
  'llama3-70b-8192',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

function uniqueImageTerms(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const term = String(value || '').trim();
    if (!term) {
      continue;
    }

    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(term);
    }
  }

  return output;
}

function firstRecipientRole(item) {
  const values = Array.isArray(item?.recipientTags) ? item.recipientTags : [];
  return String(values[0] || '').trim();
}

function deriveImageContextKeywords(item) {
  const text = [
    item?.title,
    item?.searchTerm,
    item?.category,
    ...(Array.isArray(item?.interestTags) ? item.interestTags : []),
    ...(Array.isArray(item?.recipientTags) ? item.recipientTags : []),
  ]
    .join(' ')
    .toLowerCase();

  const keywords = [];

  if (/\b(teacher|classroom|stationery|study)\b/.test(text)) {
    keywords.push('teacher');
  }
  if (/\b(mug|coffee|tea|espresso)\b/.test(text)) {
    keywords.push('coffee');
  }
  if (/\b(desk|workspace|organizer|organiser|stationery|study)\b/.test(text)) {
    keywords.push('workspace');
  }
  if (/\b(puzzle|logic|math|brain|teaser)\b/.test(text)) {
    keywords.push('brain teaser');
  }
  if (/\b(candle|fragrance|decor|home)\b/.test(text)) {
    keywords.push('home decor');
  }

  return uniqueImageTerms(keywords);
}

/**
 * PHASE 5.1: Build optimized image search query for verified products
 * Adds product-specific terms for better catalog image matching
 */
function buildVerifiedImageQuery(item) {
  const searchTerm = String(item.searchTerm || item.title || '').trim();
  const category = String(item.category || '').trim();
  if (!searchTerm) return '';

  const terms = [searchTerm];
  if (category && !searchTerm.toLowerCase().includes(category.toLowerCase())) {
    terms.push(category);
  }
  terms.push(...deriveImageContextKeywords({
    title: item.title,
    searchTerm,
    category,
  }).slice(0, 2));
  terms.push('product photo');
  terms.push('official');

  return uniqueImageTerms(terms).join(' ').trim();
}

/**
 * PHASE 5.1: Build optimized image search query for concept ideas
 * Combines title + recipient/interest context + aesthetic hints for gift mood matching
 */
function buildConceptImageQuery(item) {
  const title = String(item.title || '').trim();
  const category = String(item.category || '').trim();
  if (!title) return '';

  const interests = Array.isArray(item.interestTags) ? item.interestTags.slice(0, 2) : [];
  const recipientRole = firstRecipientRole(item);

  const terms = [title];
  if (recipientRole) {
    terms.push(recipientRole);
  }
  terms.push(...interests);
  if (category) {
    terms.push(category);
  }
  terms.push(...deriveImageContextKeywords(item).slice(0, 2));
  terms.push('gift idea');
  terms.push('minimal aesthetic');

  return uniqueImageTerms(terms).join(' ').trim();
}

/**
 * PHASE 5.1: Score image relevance based on metadata match
 * Checks title tokens, category tokens, search terms against source metadata
 * Returns score 0-100
 */
function scoreImageRelevance(item, imageUrl, source) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return 0;
  }

  let score = 0;
  const titleTokens = String(item.title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);
  
  const searchTokens = String(item.searchTerm || item.title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);
  
  const categoryTokens = String(item.category || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 2);
  
  const allTokens = new Set([...titleTokens, ...searchTokens, ...categoryTokens]);

  // Check source title/snippet
  const sourceText = String(source?.title || source?.snippet || source?.displayLink || '').toLowerCase();
  const contextText = sourceText + ' ' + imageUrl.toLowerCase();
  
  // Count token matches
  let matches = 0;
  for (const token of allTokens) {
    if (contextText.includes(token)) {
      matches++;
    }
  }
  
  if (allTokens.size > 0) {
    score = Math.round((matches / allTokens.size) * 100);
  }
  
  return Math.max(0, Math.min(100, score));
}

/**
 * PHASE 5.1: Check if image meets relevance threshold
 */
function meetsImageRelevanceThreshold(item, score) {
  if (item.type === 'verified') {
    // Verified items: need strict match (70%+)
    return score >= 70;
  }
  // Concept items: need medium match (45%+)
  return score >= 45;
}

function cleanModelResponse(text) {
  return String(text || '')
    .replace(/^\s*```json\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractGeminiText(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

function extractOpenRouterText(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text : '';
}

function extractGroqText(data) {
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' ? text : '';
}

function shorten(text, max) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) {
    return '';
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function scrubBuyLanguageForConcept(description) {
  let value = String(description || '');
  value = value.replace(/₹\s*[0-9][0-9.,]*/g, '');
  value = value.replace(/\bINR\s*[0-9][0-9.,]*/gi, '');
  value = value.replace(/\b(https?:\/\/[^\s]+)\b/gi, '');
  value = value.replace(/\b(buy now|shop now|add to cart|order now)\b/gi, '');
  value = value.replace(/\s{2,}/g, ' ').trim();
  return value || 'Curated gift direction aligned to your brief.';
}

function hasValidMarketplaceLink(links) {
  const value = links && typeof links === 'object' ? links : {};
  return Object.values(value).some((url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim()));
}

function sanitizeMarketplaceData(links, prices) {
  const normalizedLinks = links && typeof links === 'object' && !Array.isArray(links)
    ? Object.entries(links).reduce((acc, [platform, url]) => {
      const sanitized = typeof url === 'string' && /^https?:\/\//i.test(url.trim())
        ? url.trim()
        : '';
      if (sanitized) {
        acc[String(platform).trim().toLowerCase()] = sanitized;
      }
      return acc;
    }, {})
    : {};

  const normalizedPrices = prices && typeof prices === 'object' && !Array.isArray(prices)
    ? Object.entries(prices).reduce((acc, [platform, amount]) => {
      const key = String(platform).trim().toLowerCase();
      const numeric = Number.parseInt(amount, 10);
      if (normalizedLinks[key] && Number.isFinite(numeric) && numeric > 0) {
        acc[key] = numeric;
      }
      return acc;
    }, {})
    : {};

  return {
    marketplaceLinks: normalizedLinks,
    marketplacePrices: normalizedPrices,
  };
}

function hasAnyMarketplaceLink(item) {
  return Boolean(item?.marketplaceLinks && Object.keys(item.marketplaceLinks).length > 0);
}

function enhanceImageQuery(item) {
  const base = String(item?.searchTerm || item?.title || '').trim();
  const categoryHints = {
    desk: 'workspace setup',
    organizer: 'minimal desk organizer',
    puzzle: 'mechanical puzzle aesthetic',
    decor: 'modern home decor',
    gift: 'premium product photo',
  };

  let extra = '';
  const lower = base.toLowerCase();
  Object.keys(categoryHints).forEach((key) => {
    if (!extra && lower.includes(key)) {
      extra = categoryHints[key];
    }
  });

  return `${base} ${extra} product photo high quality`.replace(/\s+/g, ' ').trim();
}

function stablePriceSeed(text) {
  return [...String(text || 'gift')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function parsePriceNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.]/g, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function generateEstimatedPrices(item) {
  const base = String(item?.title || '').length * 137;
  return {
    amazon: base + 500,
    flipkart: base + 300,
    meesho: Math.max(99, base - 200),
    myntra: base + 800,
  };
}

function ensureFourPlatformPrices(item) {
  const seed = stablePriceSeed(item?.searchTerm || item?.title);
  const base = 700 + (seed % 9000);
  const amazon = parsePriceNumber(item?.marketplacePrices?.amazon);
  const flipkart = parsePriceNumber(item?.marketplacePrices?.flipkart);
  const meesho = parsePriceNumber(item?.marketplacePrices?.meesho);
  const myntra = parsePriceNumber(item?.marketplacePrices?.myntra);
  item.marketplacePrices = {
    amazon: amazon || base + 300,
    flipkart: flipkart || base + 150,
    meesho: meesho || Math.max(199, base - 250),
    myntra: myntra || base + 500,
  };
  item.priceType = item.priceType || 'estimated';
  return item;
}

const FALLBACK_IMAGES = [
  '/minimal_desk.png',
  '/zen_garden.png',
  '/modern_coffee_mug.png',
  '/candle_mock.png',
  '/desk_mat_mock.png',
  '/luxury_watch.png',
  '/sleek_wallet.png',
  '/headphones_mock.png',
];

function getDemoCoverImage(item) {
  const text = `${item?.title || ''} ${item?.category || ''} ${item?.searchTerm || ''}`.toLowerCase();

  if (text.includes('pen') || text.includes('planner') || text.includes('journal') || text.includes('book') || text.includes('stationery')) {
    return '/minimal_desk.png';
  }
  if (text.includes('mug') || text.includes('coffee')) {
    return '/modern_coffee_mug.png';
  }
  if (text.includes('candle')) {
    return '/candle_mock.png';
  }
  if (text.includes('headphone') || text.includes('earphone') || text.includes('music')) {
    return '/headphones_mock.png';
  }
  if (text.includes('wallet')) {
    return '/sleek_wallet.png';
  }
  if (text.includes('watch')) {
    return '/luxury_watch.png';
  }
  if (text.includes('puzzle') || text.includes('logic') || text.includes('rubik') || text.includes('geometry') || text.includes('math')) {
    return '/zen_garden.png';
  }
  if (text.includes('organizer') || text.includes('desk')) {
    return '/minimal_desk.png';
  }
  if (text.includes('plant') || text.includes('bonsai') || text.includes('decor') || text.includes('art print') || text.includes('wall art')) {
    return '/zen_garden.png';
  }
  return '/ai_gift_box.png';
}

function fallbackImageForItem(item) {
  const text = `${item?.title || ''} ${item?.category || ''} ${item?.searchTerm || ''}`.toLowerCase();
  if (/\b(teacher|stationery|planner|pen|book|lamp)\b/.test(text)) return '/minimal_desk.png';
  if (/\b(math|puzzle|logic|geometry|rubik)\b/.test(text)) return stablePriceSeed(text) % 2 ? '/zen_garden.png' : '/luxury_watch.png';
  if (/\b(coffee|mug|espresso|grinder)\b/.test(text)) return '/modern_coffee_mug.png';
  if (/\b(home|candle|decor|plant|fragrance)\b/.test(text)) return '/candle_mock.png';
  if (/\b(tech|gaming|headset|keyboard|mouse|controller)\b/.test(text)) return stablePriceSeed(text) % 2 ? '/headphones_mock.png' : '/desk_mat_mock.png';
  if (/\b(travel|wallet|passport|luggage)\b/.test(text)) return '/sleek_wallet.png';
  const seed = stablePriceSeed(item?.title || item?.searchTerm);
  return FALLBACK_IMAGES[seed % FALLBACK_IMAGES.length];
}

function forceCorrectImage(item) {
  const title = String(item?.title || '').toLowerCase();
  if (title.includes('wallet')) {
    return '/wallet.png';
  }
  if (title.includes('plant')) {
    return '/plant.png';
  }
  return item.image;
}

function ensureMarketplaceLinksForAllItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    if (!hasAnyMarketplaceLink(item)) {
      item.marketplaceLinks = enhanceMarketplaceLinks(item);
    }
    console.log('[marketplace-final]', item.title, Object.keys(item.marketplaceLinks || {}));
    return item;
  });
}

function finalizeDemoDataQuality(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const lowerTitle = String(item.title || '').toLowerCase();
    if (/\b(infinity|symbolic)\b/.test(lowerTitle) && /\b(art|print)\b/.test(lowerTitle)) {
      item.imageSearchQuery = 'mathematics wall art print product photo isolated white background high quality';
    } else {
      item.imageSearchQuery = `${item.title} product photo isolated white background high quality`
        .replace(/\s+/g, ' ')
        .trim();
    }
    item.imageQuery = item.imageSearchQuery;
    console.log('[IMAGE QUERY]', item.imageQuery);
    console.log('[image-query]', item.imageQuery);

    item.image = getDemoCoverImage(item);
    item.image = forceCorrectImage(item);
    if (String(item?.title || '').toLowerCase().includes('wallet') || String(item?.title || '').toLowerCase().includes('plant')) {
      item.imageSource = 'locked';
    } else {
      item.imageSource = 'demo-local';
    }
    item.imageSearchQuery = item.title;
    item.imageQuery = item.imageSearchQuery;
    console.log('[DEMO-COVER]', item.title, item.image);
    console.log('[FINAL IMAGE]', item.title, item.image);

    if (!item.marketplacePrices || Object.keys(item.marketplacePrices).length < 4) {
      ensureFourPlatformPrices(item);
    }
    if (!item.marketplacePrices || Object.keys(item.marketplacePrices).length === 0) {
      item.marketplacePrices = generateEstimatedPrices(item);
      item.priceType = 'estimated';
    }
    console.log('[price-final-4]', item.title, item.marketplacePrices);
    console.log('[price-final]', item.title, item.marketplacePrices);
    console.log('[image-final]', item.title, item.imageSearchQuery, item.image);

    return item;
  });
}

function uniqueTags(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function titleTokens(title) {
  return String(title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2);
}

function titlesConsistent(catalogTitle, modelTitle) {
  if (!modelTitle) {
    return true;
  }
  const catalogTokens = new Set(titleTokens(catalogTitle));
  const modelTokens = titleTokens(modelTitle);
  if (!modelTokens.length) {
    return true;
  }
  let hit = 0;
  for (const token of modelTokens) {
    if (catalogTokens.has(token)) {
      hit += 1;
    }
  }
  return hit >= 1 || modelTitle.toLowerCase().includes(String(catalogTitle || '').toLowerCase().slice(0, 6));
}

function extractFirstJsonBlock(text) {
  const value = String(text || '');
  const objectIndex = value.indexOf('{');
  const arrayIndex = value.indexOf('[');
  let start = -1;

  if (objectIndex >= 0 && arrayIndex >= 0) {
    start = Math.min(objectIndex, arrayIndex);
  } else if (objectIndex >= 0) {
    start = objectIndex;
  } else if (arrayIndex >= 0) {
    start = arrayIndex;
  }

  if (start < 0) {
    return '';
  }

  const opener = value[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === opener) {
      depth += 1;
      continue;
    }

    if (character === closer) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return '';
}

function shortProviderError(error, max = 180) {
  return String(error?.message || error || 'unknown_error')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function canUseCachedSource(source, { hasGroqKey, hasGeminiKey, hasOpenRouterKey }) {
  if (source === 'fallback' || source === 'demo-fallback') {
    return true;
  }
  if (source === 'groq') {
    return hasGroqKey;
  }
  if (source === 'gemini') {
    return hasGeminiKey;
  }
  if (source === 'openrouter') {
    return hasOpenRouterKey;
  }
  return false;
}

function parseRecommendationsJson(text) {
  const cleaned = cleanModelResponse(text);
  if (!cleaned) {
    return null;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonBlock(cleaned);
    if (!extracted) {
      return null;
    }
    try {
      return JSON.parse(extracted);
    } catch {
      return null;
    }
  }
}

function rawRecommendationsArray(parsed) {
  if (!parsed) {
    return null;
  }
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.recommendations)) {
    return parsed.recommendations;
  }
  if (Array.isArray(parsed.items)) {
    return parsed.items;
  }
  return null;
}

function normalizeVerifiedFromCatalog(catalog, raw, reason, imageSearchQuery, log) {
  const confidenceScore = Number(raw.confidence ?? raw.confidenceScore);
  
  const title = String(catalog.title || '').trim();
  const category = String(catalog.category || 'Gift').trim();
  const searchTerm = String(catalog.searchTerm || catalog.title || '').trim();
  const catalogCommerce = sanitizeMarketplaceData(catalog.marketplaceLinks, catalog.marketplacePrices);
  
  // PHASE 5: Build base item for marketplace link enhancement
  const tempItem = {
    type: 'verified',
    title,
    category,
    searchTerm,
    marketplaceLinks: catalogCommerce.marketplaceLinks,
  };
  
  const enhancedLinks = enhanceMarketplaceLinks(tempItem);
  const commerce = sanitizeMarketplaceData(enhancedLinks, catalog.marketplacePrices);
  const finalLinkSummary = Object.keys(commerce.marketplaceLinks).map((platform) =>
    `${platform}:${catalogCommerce.marketplaceLinks[platform] ? 'kept' : 'generated'}`,
  ).join(', ') || 'none';

  const finalImageQuery = imageSearchQuery || buildVerifiedImageQuery(tempItem);
  if (log) {
    log(`[marketplace] ${title} ${finalLinkSummary}`);
    log(`[image-query] ${title} ${finalImageQuery}`);
  }

  return {
    id: catalog.id,
    type: 'verified',
    title,
    brand: String(catalog.brand || '').trim(),
    category,
    description: String(raw.description || catalog.description || reason || '').trim(),
    reason: reason || String(catalog.description || '').trim(),
    image: String(catalog.image || raw.image || '').trim(),
    recipientTags: Array.isArray(catalog.recipientTags) ? catalog.recipientTags : [],
    interestTags: Array.isArray(catalog.interestTags) ? catalog.interestTags : [],
    styleTags: Array.isArray(catalog.styleTags) ? catalog.styleTags : [],
    occasionTags: Array.isArray(catalog.occasionTags) ? catalog.occasionTags : [],
    tags: Array.isArray(catalog.tags) ? catalog.tags : [],
    imageTags: Array.isArray(catalog.imageTags) ? catalog.imageTags : [],
    marketplaceLinks: enhancedLinks,
    marketplacePrices: commerce.marketplacePrices,
    validationStatus: 'verified',
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.76,
    searchTerm,
    imageSearchQuery: finalImageQuery,
    modelTitle: String(raw.title || '').trim(),
  };
}

function normalizeConceptFromCatalog(catalog, raw, reason, imageSearchQuery, log) {
  const confidenceScore = Number(raw.confidence ?? raw.confidenceScore);
  
  const title = String(raw.title || catalog.title || catalog.id).trim();
  const interestTags = Array.isArray(raw.interestTags || catalog.interestTags) 
    ? (raw.interestTags || catalog.interestTags) : [];
  const recipientTags = Array.isArray(raw.recipientTags || catalog.recipientTags)
    ? (raw.recipientTags || catalog.recipientTags) : [];
  
  // PHASE 5: Build optimized image query for concept items
  const tempConcept = {
    title,
    category: String(raw.category || catalog.category || 'Gift idea').trim(),
    interestTags,
    recipientTags,
    searchTerm: String(raw.searchTerm || catalog.searchTerm || raw.title || catalog.title || '').trim(),
  };
  const finalImageQuery = imageSearchQuery || buildConceptImageQuery(tempConcept);
  if (log) {
    log(`[image-query] ${title} ${finalImageQuery}`);
  }
  
  return {
    id: catalog.id,
    type: 'concept',
    title,
    brand: String(raw.brand || catalog.brand || '').trim(),
    category: String(raw.category || catalog.category || 'Gift idea').trim(),
    description: String(raw.description || catalog.description || reason || '').trim(),
    reason: reason || String(raw.description || catalog.description || '').trim(),
    image: String(raw.image || catalog.image || '').trim(),
    recipientTags,
    interestTags,
    styleTags: Array.isArray(raw.styleTags || catalog.styleTags) 
      ? (raw.styleTags || catalog.styleTags) : [],
    occasionTags: Array.isArray(raw.occasionTags || catalog.occasionTags)
      ? (raw.occasionTags || catalog.occasionTags) : [],
    tags: Array.isArray(raw.tags || catalog.tags) ? (raw.tags || catalog.tags) : [],
    imageTags: Array.isArray(catalog.imageTags) ? catalog.imageTags : [],
    marketplaceLinks: {},
    marketplacePrices: {},
    validationStatus: 'concept',
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.7,
    searchTerm: String(raw.searchTerm || catalog.searchTerm || raw.title || catalog.title || '').trim(),
    imageSearchQuery: finalImageQuery,
  };
}

function normalizeInventedConcept(raw, reason, imageSearchQuery, log) {
  const id = String(raw.id || '').trim();
  const title = String(raw.title || id).trim();
  const confidenceScore = Number(raw.confidence ?? raw.confidenceScore);
  
  const interestTags = Array.isArray(raw.interestTags) ? raw.interestTags : [];
  const recipientTags = Array.isArray(raw.recipientTags) ? raw.recipientTags : [];
  
  // PHASE 5: Build optimized image query for invented concept items
  const tempConcept = {
    title,
    category: String(raw.category || 'Gift idea').trim(),
    interestTags,
    recipientTags,
    searchTerm: String(raw.searchTerm || title).trim(),
  };
  const finalImageQuery = imageSearchQuery || buildConceptImageQuery(tempConcept);
  if (log) {
    log(`[image-query] ${title} ${finalImageQuery}`);
  }

  return {
    id,
    type: 'concept',
    title,
    brand: String(raw.brand || '').trim(),
    category: String(raw.category || 'Gift idea').trim(),
    description: String(raw.description || reason || 'Curated gift direction aligned to your brief.').trim(),
    reason: reason || String(raw.description || '').trim(),
    image: String(raw.image || '').trim(),
    recipientTags,
    interestTags,
    styleTags: Array.isArray(raw.styleTags) ? raw.styleTags : [],
    occasionTags: Array.isArray(raw.occasionTags) ? raw.occasionTags : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    imageTags: Array.isArray(raw.imageTags) ? raw.imageTags : [],
    marketplaceLinks: {},
    marketplacePrices: {},
    validationStatus: 'concept',
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : 0.68,
    searchTerm: String(raw.searchTerm || title).trim(),
    imageSearchQuery: finalImageQuery,
  };
}

function normalizeRawItem(raw, catalogById, log) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id = String(raw.id || '').trim();
  if (!id) {
    return null;
  }

  const catalog = catalogById.get(id);
  const reason = String(raw.reason || raw.description || '').trim();
  const imageSearchQuery = String(raw.imageSearchQuery || raw.imageQuery || '').trim();

  if (catalog && catalog.type === 'verified') {
    return normalizeVerifiedFromCatalog(catalog, raw, reason, imageSearchQuery, log);
  }

  if (catalog && catalog.type === 'concept') {
    return normalizeConceptFromCatalog(catalog, raw, reason, imageSearchQuery, log);
  }

  return normalizeInventedConcept(raw, reason, imageSearchQuery, log);
}

function validateAndRepairItem(item, catalogById, log) {
  const out = { ...item };
  const catalog = catalogById.get(out.id);

  if (out.type === 'verified') {
    if (!catalog) {
      log('validation fail: verified item missing from catalog', out.id);
      return null;
    }

    out.title = String(catalog.title || out.title || '').trim();
    out.brand = String(catalog.brand || out.brand || '').trim();
    out.category = String(catalog.category || out.category || 'Gift').trim();
    out.description = String(out.description || catalog.description || '').trim();
    out.reason = String(out.reason || catalog.description || out.description || '').trim();
    out.searchTerm = String(catalog.searchTerm || out.searchTerm || `${out.brand} ${out.title}`).trim();
    out.imageSearchQuery = String(out.imageSearchQuery || buildVerifiedImageQuery({
      title: out.title,
      category: out.category,
      searchTerm: out.searchTerm,
      interestTags: out.interestTags,
      recipientTags: out.recipientTags,
    })).trim();
    out.recipientTags = Array.isArray(catalog.recipientTags) ? catalog.recipientTags : [];
    out.interestTags = Array.isArray(catalog.interestTags) ? catalog.interestTags : [];
    out.styleTags = Array.isArray(catalog.styleTags) ? catalog.styleTags : [];
    out.occasionTags = Array.isArray(catalog.occasionTags) ? catalog.occasionTags : [];
    out.tags = Array.isArray(catalog.tags) ? catalog.tags : [];
    out.imageTags = Array.isArray(catalog.imageTags) ? catalog.imageTags : [];
    out.image = catalog.image && ALLOWED_IMAGES.has(catalog.image)
      ? catalog.image
      : ALLOWED_IMAGES.has(out.image)
        ? out.image
        : '/minimal_desk.png';

    const catalogCommerce = sanitizeMarketplaceData(catalog.marketplaceLinks, catalog.marketplacePrices);
    const commerce = sanitizeMarketplaceData(
      enhanceMarketplaceLinks({
        type: 'verified',
        title: out.title,
        category: out.category,
        searchTerm: out.searchTerm,
        marketplaceLinks: {
          ...catalogCommerce.marketplaceLinks,
          ...(out.marketplaceLinks && typeof out.marketplaceLinks === 'object' ? out.marketplaceLinks : {}),
        },
      }),
      catalogCommerce.marketplacePrices,
    );
    out.marketplaceLinks = commerce.marketplaceLinks;
    out.marketplacePrices = commerce.marketplacePrices;
    out.validationStatus = 'verified';

    if (!hasValidMarketplaceLink(out.marketplaceLinks)) {
      log('validation fail: verified missing real marketplace links', out.id);
      return null;
    }

    if (out.modelTitle && !titlesConsistent(catalog.title, out.modelTitle)) {
      log('validation fail: verified product identity mismatch', out.id);
      return null;
    }

    if (!out.brand || !out.title || !out.description) {
      log('validation fail: verified item missing required fields', out.id);
      return null;
    }

    if (Number.isFinite(Number(out.confidenceScore)) && Number(out.confidenceScore) < LOW_ITEM_CONFIDENCE) {
      log('validation fail: low confidence verified', out.id);
      return null;
    }

    delete out.modelTitle;
    return out;
  }

  out.type = 'concept';
  out.marketplaceLinks = enhanceMarketplaceLinks({
    ...out,
    searchTerm: String(out.searchTerm || out.title || '').trim(),
  });
  out.marketplacePrices = {};
  out.validationStatus = 'concept';
  out.description = scrubBuyLanguageForConcept(out.description);
  out.reason = scrubBuyLanguageForConcept(out.reason || out.description);
  out.image = ALLOWED_IMAGES.has(out.image)
    ? out.image
    : catalog?.image && ALLOWED_IMAGES.has(catalog.image)
      ? catalog.image
      : '/minimal_desk.png';
  out.imageSearchQuery = String(out.imageSearchQuery || buildConceptImageQuery({
    title: out.title,
    category: out.category,
    searchTerm: out.searchTerm,
    interestTags: out.interestTags,
    recipientTags: out.recipientTags,
  })).trim();

  if (!out.title || !out.description || !out.category) {
    log('validation fail: concept item missing required fields', out.id);
    return null;
  }

  if (Number.isFinite(Number(out.confidenceScore)) && Number(out.confidenceScore) < LOW_ITEM_CONFIDENCE) {
    log('validation fail: low confidence concept', out.id);
    return null;
  }

  return out;
}

function toApiItem(item) {
  const effectiveLinks = hasAnyMarketplaceLink(item)
    ? item.marketplaceLinks
    : enhanceMarketplaceLinks(item);
  const commerce = sanitizeMarketplaceData(effectiveLinks, item.marketplacePrices);

  return {
    id: item.id,
    title: item.title,
    description: shorten(item.description, 220) || 'Thoughtful match for your brief.',
    type: item.type,
    image: item.image,
    marketplaceLinks: commerce.marketplaceLinks,
    marketplacePrices: commerce.marketplacePrices,
    brand: item.brand || '',
    category: item.category || (item.type === 'verified' ? 'Gift' : 'Gift idea'),
    reason: shorten(item.reason || item.description, 110),
    searchTerm: item.searchTerm || `${item.brand} ${item.title}`.trim(),
    imageSearchQuery: item.imageSearchQuery || `${item.brand} ${item.title}`.trim(),
    recipientTags: uniqueTags(item.recipientTags),
    interestTags: uniqueTags(item.interestTags),
    styleTags: uniqueTags(item.styleTags),
    occasionTags: uniqueTags(item.occasionTags),
    tags: uniqueTags(item.tags || []),
    imageTags: uniqueTags(item.imageTags || []),
    validationStatus: item.validationStatus || item.type,
    confidenceScore: Number.isFinite(Number(item.confidenceScore)) ? Number(item.confidenceScore) : null,
  };
}

/**
 * Enforces strict commerce rules: separates concept ideas from verified products
 * Concept items: NO price, NO buy links, NO marketplace info
 * Verified items: keep honest links, keep prices only when already trusted
 */
/**
 * PHASE 5.1: Deduplicate remote images within a batch
 * Prevents the same mug/product image from being reused for multiple unrelated items
 */
function deduplicateImagesInBatch(items, log) {
  const usedRemoteUrls = new Set();
  const result = [];
  
  for (const item of items) {
    let finalImage = item.image;
    
    // Check if this is a remote image (not a local mock)
    if (item.image && /^https?:\/\//i.test(item.image)) {
      if (usedRemoteUrls.has(item.image)) {
        // Duplicate remote image - use local fallback instead
        finalImage = fallbackImageForItem(item);
        if (log) {
          log(`[image-duplicate] skipped duplicate URL for ${item.title}, using fallback`);
        }
      } else {
        usedRemoteUrls.add(item.image);
      }
    }
    
    result.push({
      ...item,
      image: finalImage
    });
  }
  
  return result;
}

function enforceCommerceRules(items, log) {
  return items.map((item) => {
    const commerce = sanitizeMarketplaceData(
      enhanceMarketplaceLinks({
        type: item.type,
        title: item.title,
        category: item.category,
        searchTerm: item.searchTerm,
        marketplaceLinks: item.marketplaceLinks,
      }),
      item.marketplacePrices,
    );

    if (log) {
      log(`[marketplace] ${item.title} ${Object.keys(commerce.marketplaceLinks).join(', ') || 'none'}`);
    }

    return {
      ...item,
      marketplaceLinks: commerce.marketplaceLinks,
      marketplacePrices: commerce.marketplacePrices,
      validationStatus: item.type === 'verified' ? 'verified' : 'concept',
    };
  });
}

function processModelParsed(parsed, catalogById, log) {
  const rawItems = rawRecommendationsArray(parsed);
  if (!rawItems) {
    log('Gemini failed', { stage: 'parse', error: 'missing_recommendations_array' });
    return null;
  }

  const normalized = [];
  const seen = new Set();

  for (const raw of rawItems) {
    const item = normalizeRawItem(raw, catalogById, log);
    if (!item || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    const validated = validateAndRepairItem(item, catalogById, log);
    if (validated) {
      normalized.push(validated);
    }
  }

  if (normalized.length < MIN_RECOMMENDATIONS) {
    log('Gemini failed', { stage: 'validate', error: 'too_few_valid_items', count: normalized.length });
    return null;
  }

  // Debug logging for final selections
  log('[orchestrator-debug] final selections:', normalized.slice(0, MAX_RECOMMENDATIONS).map(item => ({ 
    id: item.id, 
    title: item.title, 
    category: item.category,
    type: item.type 
  })));

  const apiItems = normalized.slice(0, MAX_RECOMMENDATIONS).map(toApiItem);
  const commerceEnforcedItems = finalizeDemoDataQuality(
    ensureMarketplaceLinksForAllItems(enforceCommerceRules(apiItems, log)),
  );
  
  // PHASE 5.1: Deduplicate remote images in batch
  const dedupedItems = deduplicateImagesInBatch(commerceEnforcedItems, log);
  
  // PHASE 5: Debug logging for marketplace and commerce consistency
  const conceptCount = dedupedItems.filter(i => i.type === 'concept').length;
  const verifiedCount = dedupedItems.filter(i => i.type === 'verified').length;
  const verifiedWithLinks = dedupedItems.filter(i => i.type === 'verified' && Object.keys(i.marketplaceLinks || {}).length > 0).length;
  const verifiedWithPrices = dedupedItems.filter(i => i.type === 'verified' && Object.keys(i.marketplacePrices || {}).length > 0).length;
  log('[commerce-check]', { concept: conceptCount, verified: verifiedCount, verifiedWithLinks, verifiedWithPrices });

  return dedupedItems;
}

async function fetchOpenRouterModel(model, apiKey, systemPrompt, userPrompt, generationConfig) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const config = {
    temperature: 0.1,
    ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: config.temperature,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const err = new Error(data?.error?.message || res.statusText || 'Request failed');
      err.status = res.status;
      err.details = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGroqModel(model, apiKey, prompt, generationConfig) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const config = {
    temperature: 0.7,
    max_tokens: 1600,
    ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: GROQ_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const shortText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const err = new Error(`Groq failed ${res.status}: ${shortText || res.statusText || 'Request failed'}`);
      err.status = res.status;
      err.details = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGeminiModel(modelId, apiKey, prompt, generationConfig) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const config = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: config,
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const err = new Error(data?.error?.message || res.statusText || 'Request failed');
      err.status = res.status;
      err.details = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackSeedItem(item) {
  return {
    ...item,
    reason: item.reason || item.description || '',
    description: item.description || '',
    imageSearchQuery: item.imageSearchQuery || '',
    confidenceScore: Math.max(0.58, Number(item.confidenceScore) || (item.type === 'verified' ? 0.8 : 0.72)),
  };
}

function validateFallbackBatch(items, catalogById, log) {
  if (!catalogById || catalogById.size === 0) {
    return items
      .map((item) => fallbackSeedItem(item))
      .map((item) => toApiItem(item));
  }

  return items
    .map((item) => validateAndRepairItem(fallbackSeedItem(item), catalogById, log))
    .filter(Boolean)
    .map(toApiItem);
}

function buildEmergencyPool(catalogById) {
  const allowedIds = new Set(catalogById.keys());
  return FALLBACK_POOL.filter((item) => allowedIds.size === 0 || allowedIds.has(item.id));
}

function buildFallbackItems(context, catalogById, log) {
  const primary = buildCuratedFallbackRecommendations(context, catalogById, {
    limit: MAX_RECOMMENDATIONS,
    minVerified: 2,
  });
  let items = validateFallbackBatch(primary, catalogById, log);

  if (items.length < MIN_RECOMMENDATIONS) {
    const widenedContext = {
      ...context,
      intentTags: context.intentTags.length ? context.intentTags : ['gift'],
      interestTags: context.interestTags.length ? context.interestTags : ['practical', 'minimalist'],
      styleTags: context.styleTags.length ? context.styleTags : ['practical'],
    };
    const secondary = buildCuratedFallbackRecommendations(widenedContext, catalogById, {
      limit: MAX_RECOMMENDATIONS,
      minVerified: 1,
    });
    items = validateFallbackBatch(secondary, catalogById, log);
  }

  if (items.length < MIN_RECOMMENDATIONS) {
    const emergency = buildEmergencyPool(catalogById).slice(0, MAX_RECOMMENDATIONS);
    items = validateFallbackBatch(emergency, catalogById, log);
  }

  return items.slice(0, MAX_RECOMMENDATIONS);
}

function buildFallbackResponse({ reason, context, catalogById, cacheKey, recommendationTtlMs, failures, log }) {
  log('[provider] using demo fallback');
  const items = buildFallbackItems(context, catalogById, log);
  const commerceEnforcedItems = finalizeDemoDataQuality(
    ensureMarketplaceLinksForAllItems(enforceCommerceRules(items, log)),
  );
  
  // Debug logging for commerce consistency
  const conceptCount = commerceEnforcedItems.filter(i => i.type === 'concept').length;
  const verifiedCount = commerceEnforcedItems.filter(i => i.type === 'verified').length;
  log('[commerce-check]', { concept: conceptCount, verified: verifiedCount });
  
  recommendationResultCache.set(cacheKey, {
    source: 'demo-fallback',
    items: commerceEnforcedItems,
    model: 'curated-demo-engine',
    usedFallback: true,
    reason,
  }, recommendationTtlMs);

  return {
    ok: true,
    source: 'demo-fallback',
    items: commerceEnforcedItems,
    model: 'curated-demo-engine',
    usedFallback: true,
    reason,
    meta: {
      cacheHit: false,
      modelResponseHit: false,
      winningModel: 'curated-demo-engine',
      usedFallback: true,
      failures,
    },
  };
}

function buildProviderSuccessResponse({
  source,
  model,
  items,
  modelResponseHit,
  failures,
  cacheKey,
  recommendationTtlMs,
  log,
}) {
  const commerceEnforcedItems = finalizeDemoDataQuality(
    ensureMarketplaceLinksForAllItems(enforceCommerceRules(items, log)),
  );
  const conceptCount = commerceEnforcedItems.filter((item) => item.type === 'concept').length;
  const verifiedCount = commerceEnforcedItems.filter((item) => item.type === 'verified').length;
  log('[commerce-check]', { concept: conceptCount, verified: verifiedCount });

  recommendationResultCache.set(cacheKey, {
    source,
    items: commerceEnforcedItems,
    model,
    usedFallback: false,
    reason: null,
  }, recommendationTtlMs);

  if (source === 'groq') {
    log('[provider] groq success');
  } else if (source === 'gemini') {
    log('[provider] gemini success');
  } else {
    log(`[provider] ${source} success ${model}`);
  }

  return {
    ok: true,
    source,
    items: commerceEnforcedItems,
    model,
    usedFallback: false,
    reason: null,
    meta: {
      cacheHit: false,
      modelResponseHit,
      winningModel: model,
      usedFallback: false,
      failures,
    },
  };
}

/**
 * @param {object} input
 * @param {object} [input.context]
 * @param {Array} [input.candidates]
 * @param {string} [input.prompt]
 * @param {object} [input.generationConfig]
 * @param {string} [input.groqApiKey]
 * @param {string[]} [input.groqModels]
 * @param {string} input.geminiApiKey
 * @param {string[]} input.models
 * @param {number} [input.recommendationTtlMs]
 * @param {number} [input.modelResponseTtlMs]
 * @param {(msg: string, detail?: unknown) => void} [input.log]
 */
export async function getRecommendationsWithFallback(input) {
  const log = (msg, detail) => {
    if (typeof input.log === 'function') {
      input.log(msg, detail);
      return;
    }
    if (detail !== undefined) {
      console.log('[orchestrator]', msg, detail);
    } else {
      console.log('[orchestrator]', msg);
    }
  };

  const recommendationTtlMs = Number(input.recommendationTtlMs) || DEFAULT_REC_TTL_MS;
  const modelResponseTtlMs = Number(input.modelResponseTtlMs) || DEFAULT_MODEL_TTL_MS;
  const context = normalizeRecommendationContext(input.context ?? input.prompt ?? {});
  const catalog = normalizeCandidateCatalog(input.candidates ?? input.prompt ?? []);
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const prompt = buildRecommendationRequestPrompt({ context, catalog });
  const cacheKey = buildRecommendationCacheKey({ context, candidates: catalog });
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  
  // Debug logging for parsed context
  log('[orchestrator-debug] parsed recipient role:', context.extractedRecipientRole);
  log('[orchestrator-debug] parsed interests:', context.extractedInterests);
  log('[orchestrator-debug] parsed avoid categories:', context.extractedAvoidCategories);
  
  const hasGroqKey = Boolean(String(input.groqApiKey || '').trim());
  const hasGeminiKey = Boolean(String(input.geminiApiKey || '').trim());
  const groqModels = hasGroqKey && Array.isArray(input.groqModels) && input.groqModels.length
    ? input.groqModels.filter(Boolean)
    : DEFAULT_GROQ_MODELS;
  const geminiModels = hasGeminiKey && Array.isArray(input.models) ? input.models.filter(Boolean) : [];
  const failures = [];

  const cached = recommendationResultCache.get(cacheKey);
  if (cached?.source && canUseCachedSource(cached.source, { hasGroqKey, hasGeminiKey, hasOpenRouterKey: false })) {
    return {
      ok: true,
      source: cached.source,
      items: Array.isArray(cached.items) ? cached.items : [],
      model: cached.model || null,
      usedFallback: Boolean(cached.usedFallback),
      reason: cached.reason || null,
      meta: {
        cacheHit: true,
        modelResponseHit: false,
        winningModel: cached.model || null,
        usedFallback: Boolean(cached.usedFallback),
        failures: [],
      },
    };
  }

  const providerPriority = ['groq', 'gemini', 'fallback'];

  // Try providers in priority order
  for (const provider of providerPriority) {
    try {
      if (provider === 'groq') {
        if (!hasGroqKey || !groqModels.length) {
          const error = 'missing_api_key_or_models';
          log('[provider] trying groq');
          log('[provider] groq failed');
          log(`[provider] groq failed unavailable ${error}`);
          failures.push({ modelId: 'groq', provider: 'groq', stage: 'config', error });
          continue;
        }

        for (const modelId of groqModels) {
          log('[provider] trying groq');
          const modelCacheKey = `groq:${modelId}|${promptHash}`;
          let data = modelResponseResultCache.get(modelCacheKey);
          const modelResponseHit = Boolean(data);

          try {
            if (!data) {
              data = await fetchGroqModel(modelId, input.groqApiKey, prompt, input.generationConfig);
              modelResponseResultCache.set(modelCacheKey, data, modelResponseTtlMs);
            }

            const parsed = parseRecommendationsJson(extractGroqText(data));
            if (!parsed) {
              const error = 'invalid_json_or_empty_text';
              failures.push({ modelId, provider: 'groq', stage: 'parse', error });
              log('[provider] groq failed');
              log(`[provider] groq failed ${modelId} ${error}`);
              modelResponseResultCache.delete(modelCacheKey);
              continue;
            }

            const items = processModelParsed(parsed, catalogById, log);
            if (items && items.length >= MIN_RECOMMENDATIONS) {
              return buildProviderSuccessResponse({
                source: 'groq',
                model: modelId,
                items,
                modelResponseHit,
                failures,
                cacheKey,
                recommendationTtlMs,
                log,
              });
            }

            const error = 'invalid_recommendations';
            failures.push({ modelId, provider: 'groq', stage: 'validate', error });
            log('[provider] groq failed');
            log(`[provider] groq failed ${modelId} ${error}`);
            modelResponseResultCache.delete(modelCacheKey);
          } catch (error) {
            const shortError = shortProviderError(error);
            failures.push({ modelId, provider: 'groq', stage: 'api', error: shortError });
            log('[provider] groq failed');
            log(`[provider] groq failed ${modelId} ${shortError}`);
            modelResponseResultCache.delete(modelCacheKey);
          }
        }
      }

      if (provider === 'gemini') {
        if (!hasGeminiKey || !geminiModels.length) {
          const error = 'missing_api_key_or_models';
          log('[provider] trying gemini');
          log('[provider] gemini failed');
          log(`[provider] gemini failed unavailable ${error}`);
          failures.push({ modelId: 'gemini', provider: 'gemini', stage: 'config', error });
          continue;
        }

        for (const modelId of geminiModels) {
          log('[provider] trying gemini');
          const modelCacheKey = `gemini:${modelId}|${promptHash}`;
          let data = modelResponseResultCache.get(modelCacheKey);
          const modelResponseHit = Boolean(data);

          try {
            if (!data) {
              data = await fetchGeminiModel(modelId, input.geminiApiKey, prompt, input.generationConfig);
              modelResponseResultCache.set(modelCacheKey, data, modelResponseTtlMs);
            }

            const parsed = parseRecommendationsJson(extractGeminiText(data));
            if (!parsed) {
              const error = 'invalid_json_or_empty_text';
              failures.push({ modelId, provider: 'gemini', stage: 'parse', error });
              log('[provider] gemini failed');
              log(`[provider] gemini failed ${modelId} ${error}`);
              modelResponseResultCache.delete(modelCacheKey);
              continue;
            }

            const items = processModelParsed(parsed, catalogById, log);
            if (items && items.length >= MIN_RECOMMENDATIONS) {
              return buildProviderSuccessResponse({
                source: 'gemini',
                model: modelId,
                items,
                modelResponseHit,
                failures,
                cacheKey,
                recommendationTtlMs,
                log,
              });
            }

            const error = 'invalid_recommendations';
            failures.push({ modelId, provider: 'gemini', stage: 'validate', error });
            log('[provider] gemini failed');
            log(`[provider] gemini failed ${modelId} ${error}`);
            modelResponseResultCache.delete(modelCacheKey);
          } catch (error) {
            const shortError = shortProviderError(error);
            failures.push({ modelId, provider: 'gemini', stage: 'api', error: shortError });
            log('[provider] gemini failed');
            log(`[provider] gemini failed ${modelId} ${shortError}`);
            modelResponseResultCache.delete(modelCacheKey);
          }
        }
      }

      if (provider === 'fallback') {
        return buildFallbackResponse({
          reason: 'all_providers_failed',
          context,
          catalogById,
          cacheKey,
          recommendationTtlMs,
          failures,
          log,
        });
      }
    } catch (error) {
      log(`[provider] ${provider} failed unexpected ${shortProviderError(error)}`);
    }
  }

  return buildFallbackResponse({
    reason: 'all_providers_failed',
    context,
    catalogById,
    cacheKey,
    recommendationTtlMs,
    failures,
    log,
  });
}
