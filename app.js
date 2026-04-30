import './theme.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  isFirebaseConfigured,
  subscribeAuth,
  signUpEmail,
  signInEmail,
  signOutUser,
  subscribeWishlistItems,
  saveWishlistItem,
  removeWishlistItem,
} from './firebaseClient.js';
import { enhanceMarketplaceLinks as resolveVerifiedMarketplaceLinks } from './marketplaceResolver.js';

gsap.registerPlugin(ScrollTrigger);

const BASE_URL = import.meta.env.BASE_URL;
const ALLOWED_IMAGES = new Set([
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
const DISALLOWED_PLACEHOLDER_IMAGES = new Set(['/ai_gift_box.png']);
const LOCAL_WISHLIST_KEY = 'giftai_wishlist_v1';

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function getApiBase() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw === 'string' && raw.trim()) {
    const normalized = raw.trim().replace(/\/$/, '');
    try {
      const configuredUrl = new URL(normalized, window.location.origin);
      if (isLoopbackHost(configuredUrl.hostname) && !isLoopbackHost(window.location.hostname)) {
        return '';
      }
      return configuredUrl.origin === window.location.origin ? '' : normalized;
    } catch {
      return normalized;
    }
  }
  return '';
}

function applyAffiliateToMarketplaceUrl(url, platform) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return url;
  }

  try {
    const u = new URL(url);
    if (platform === 'amazon') {
      const tag = import.meta.env.VITE_AMAZON_AFFILIATE_TAG;
      if (tag) {
        u.searchParams.set('tag', String(tag));
      }
    }
    if (platform === 'flipkart') {
      const affid = import.meta.env.VITE_FLIPKART_AFFILIATE_ID;
      if (affid) {
        u.searchParams.set('affid', String(affid));
      }
    }
    return u.toString();
  } catch {
    return url;
  }
}

function wishlistPayloadFromItem(item) {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    category: item.category,
    image: item.image,
    searchTerm: item.searchTerm || '',
    imageSearchQuery: item.imageSearchQuery || '',
    marketplaceLinks: item.marketplaceLinks || {},
    marketplacePrices: item.marketplacePrices || {},
  };
}

function readLocalWishlist() {
  try {
    const raw = localStorage.getItem(LOCAL_WISHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalWishlist(rows) {
  try {
    localStorage.setItem(LOCAL_WISHLIST_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

let wishlistIdSet = new Set();

function recomputeWishlistIdSetFromRows(rows) {
  wishlistIdSet = new Set((rows || []).map((row) => row?.id).filter(Boolean));
}

async function hydrateResultImages(items, resultsArea) {
  const base = getApiBase();
  const cards = [...resultsArea.querySelectorAll('.result-card:not(.result-card--loading)')];

  // PHASE 5: Track used remote image URLs to prevent duplicates
  const usedRemoteUrls = new Set();
  const usedImages = new Set();

  for (const [index, item] of items.entries()) {
    const card = cards[index];
    if (!card || item?.type === 'clarify') {
      continue;
    }

    if (item?.imageSource === 'demo-local' || item?.imageSource === 'locked') {
      const img = card.querySelector('.card-img');
      if (img && item.image) {
        img.src = resolveAssetPath(item.image);
      }
      card.dataset.imageSource = item?.imageSource || 'demo-local';
      if (item?.imageSource === 'locked') {
        console.log('[IMAGE LOCKED]', item.title);
      }
      console.log('[image-locked]', item.title, item.image);
      continue;
    }

    const localImage = String(item?.image || '').trim();
    const shouldReplaceLocal =
      !localImage
      || localImage.includes('ai_gift_box')
      || (localImage && !/^https?:\/\//i.test(localImage) && usedImages.has(localImage));
    if (shouldReplaceLocal) {
      const replacement = pickUniqueFallbackImage(item, usedImages);
      item.image = replacement;
      const previewImg = card.querySelector('.card-img');
      if (previewImg) {
        previewImg.src = resolveAssetPath(replacement);
      }
    }
    if (item.image && !/^https?:\/\//i.test(item.image)) {
      usedImages.add(item.image);
    }

    const q = item.imageSearchQuery || item.searchTerm || item.title;
    if (!q) {
      continue;
    }

    const mode = item.type === 'verified' ? 'product' : 'concept';
    try {
      const params = new URLSearchParams({
        mode,
        q,
        title: item.title || '',
        searchTerm: item.searchTerm || '',
        category: item.category || '',
        recipientRole: Array.isArray(item.recipientTags) ? String(item.recipientTags[0] || '') : '',
        interestTags: Array.isArray(item.interestTags) ? item.interestTags.join(',') : '',
      });
      console.log(`[image-query] ${item.title} ${q}`);
      const res = await fetch(`${base}/api/images/resolve?${params.toString()}`);
      if (!res.ok) {
        card.dataset.imageSource = 'fallback';
        continue;
      }
      const data = await res.json();
      const src = data.primaryUrl || (item.type === 'verified' ? data.googleUrl : (data.googleUrl || data.unsplashUrl)) || null;
      if (!src) {
        card.dataset.imageSource = 'fallback';
        continue;
      }
      if (item.type === 'verified' && data.source !== 'google') {
        card.dataset.imageSource = 'fallback';
        continue;
      }
      if (item.type === 'concept' && !['google', 'unsplash'].includes(data.source || '')) {
        card.dataset.imageSource = 'fallback';
        continue;
      }

      // PHASE 5: Check for duplicate remote images
      if (usedRemoteUrls.has(src)) {
        console.log(`[image-duplicate] skipped duplicate URL ${item.title}`);
        console.log('[image-final]', item.title, item.image);
        card.dataset.imageSource = 'fallback';
        continue;
      }
      usedRemoteUrls.add(src);
      console.log(`[image-score] ${item.title} ${data.source || 'fallback'} ${Number.isFinite(Number(data.sourceConfidence)) ? Number(data.sourceConfidence) : 'n/a'}`);

      const img = card.querySelector('.card-img');
      if (img) {
        img.src = src;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
      }
      if (window.currentMockItemsById?.has(item.id)) {
        const stored = window.currentMockItemsById.get(item.id);
        if (stored) {
          stored.image = src;
          stored.imageSource = data.source || 'api';
          stored.imageTrust = item.type === 'verified' && data.source === 'google'
            ? 'backend-scored-product'
            : item.type === 'concept' && data.source === 'unsplash'
              ? 'concept-mood'
              : 'fallback';
          stored.imageSourceMetadata = data.sourceMetadata || null;
        }
      }
      item.image = src;
      item.imageSource = data.source || 'api';
      item.imageTrust = item.type === 'verified' && data.source === 'google'
        ? 'backend-scored-product'
        : item.type === 'concept' && data.source === 'unsplash'
          ? 'concept-mood'
          : 'fallback';
      item.imageSourceMetadata = data.sourceMetadata || null;
      card.dataset.imageSource = data.source || 'api';
      if (item.image && !/^https?:\/\//i.test(item.image)) {
        usedImages.add(item.image);
      }
      if (item.image && /^https?:\/\//i.test(item.image)) {
        usedImages.add(item.image);
      }
      console.log('[FINAL-DEMO-IMAGE]', item.title, item.image);
      console.log('[image-final]', item.title, item.image);
    } catch {
      card.dataset.imageSource = 'fallback';
      console.log('[FINAL-DEMO-IMAGE]', item?.title || '', item?.image || '');
      console.log('[image-final]', item?.title || '', item?.image || '');
      /* ignore */
    }
  }
}

function resolveAssetPath(path) {
  if (typeof path !== 'string' || !path) {
    return path;
  }

  if (/^(?:https?:)?\/\//.test(path) || path.startsWith('data:')) {
    return path;
  }

  const demoAliases = {
    '/perfume.png': '/elegant_perfume.png',
    '/wallet.png': '/sleek_wallet.png',
    '/plant.png': '/zen_garden.png',
  };
  const aliased = demoAliases[path] || path;

  return `${BASE_URL}${aliased.replace(/^\//, '')}`;
}

const MARKETPLACE_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];
const PLATFORM_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];
const fallbackImages = [
  '/minimal_desk.png',
  '/zen_garden.png',
  '/modern_coffee_mug.png',
  '/candle_mock.png',
  '/desk_mat_mock.png',
  '/luxury_watch.png',
  '/sleek_wallet.png',
  '/headphones_mock.png',
];

function stableSeed(text) {
  return [...String(text || 'gift')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

function parsePriceValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function ensureModalPrices(item) {
  const seed = stableSeed(item?.searchTerm || item?.title || 'gift');
  const base = 499 + (seed % 8500);
  const existing = item?.marketplacePrices || {};

  item.marketplacePrices = {
    amazon: parsePriceValue(existing.amazon) || base + 300,
    flipkart: parsePriceValue(existing.flipkart) || base + 150,
    meesho: parsePriceValue(existing.meesho) || Math.max(199, base - 250),
    myntra: parsePriceValue(existing.myntra) || base + 500,
  };

  item.priceType = item.priceType || 'estimated';
  return item;
}

function pickUniqueFallbackImage(item, usedImages) {
  const seed = stableSeed(item?.title || item?.searchTerm);
  for (let i = 0; i < fallbackImages.length; i += 1) {
    const candidate = fallbackImages[(seed + i) % fallbackImages.length];
    if (!usedImages.has(candidate)) return candidate;
  }
  return fallbackImages[seed % fallbackImages.length];
}
const MARKETPLACE_CONFIG = {
  amazon: {
    label: 'Amazon',
    domainPattern: /amazon\.in/i,
    createUrl: (query) => `https://www.amazon.in/s?k=${encodeURIComponent(query)}`,
  },
  flipkart: {
    label: 'Flipkart',
    domainPattern: /flipkart\.com/i,
    createUrl: (query) => `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`,
  },
  myntra: {
    label: 'Myntra',
    domainPattern: /myntra\.com/i,
    createUrl: (query) => `https://www.myntra.com/${encodeURIComponent(query).replace(/%20/g, '-')}`,
  },
  meesho: {
    label: 'Meesho',
    domainPattern: /meesho\.com/i,
    createUrl: (query) => `https://www.meesho.com/search?q=${encodeURIComponent(query)}`,
  },
};

function inferRelevantMarketplaces(product) {
  const category = normalizeSearchText(product?.category || '');
  const title = normalizeSearchText(product?.title || '');
  const text = `${title} ${category}`;

  const allow = new Set(['amazon', 'flipkart']);

  // Myntra is strongest for watches/fashion/accessories.
  if (text.includes('watch') || text.includes('watches') || text.includes('fashion') || text.includes('accessor')) {
    allow.add('myntra');
  }

  // Meesho is more plausible for home/fragrance/decor/value categories.
  if (text.includes('home') || text.includes('fragrance') || text.includes('decor') || text.includes('gift') || text.includes('workspace')) {
    allow.add('meesho');
  }

  return [...allow].filter((platform) => MARKETPLACE_ORDER.includes(platform));
}

function enrichMarketplaceLinks(product) {
  if (!product) {
    return {};
  }

  return resolveVerifiedMarketplaceLinks({
    ...product,
    type: 'verified',
  });
}
const RESULT_LABELS = ['Editor pick', 'Statement gift', 'Daily upgrade', 'Conversation starter', 'Quiet luxury', 'Smart utility'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEV_CONTRACT_ASSERTIONS = Boolean(import.meta.env?.DEV);

const KNOWN_OCCASIONS = new Set(['birthday', 'anniversary', 'promotion', 'housewarming', 'just-because']);
const OCCASION_SIGNAL_MAP = [
  { tag: 'birthday', patterns: ['birthday', 'bday'] },
  { tag: 'anniversary', patterns: ['anniversary', 'date night', 'romantic'] },
  { tag: 'promotion', patterns: ['promotion', 'promoted', 'new job', 'first job', 'raise'] },
  { tag: 'housewarming', patterns: ['housewarming', 'new home', 'new apartment', 'moved in'] },
  { tag: 'just-because', patterns: ['just because', 'thinking of', 'no reason', 'surprise gift'] },
];
const OCCASION_REFINEMENT_MAP = {
  birthday: {
    preferredGroups: ['coffee', 'drinkware', 'workspace', 'camera', 'audio'],
    preferredStyles: ['tech', 'practical', 'design'],
  },
  anniversary: {
    preferredGroups: ['stationery', 'reading', 'coffee'],
    preferredStyles: ['luxury', 'design', 'minimalist'],
    discouragedGroups: ['travel'],
  },
  promotion: {
    preferredGroups: ['workspace', 'stationery', 'travel', 'watch', 'coffee'],
    preferredStyles: ['desk', 'practical', 'luxury'],
  },
  housewarming: {
    preferredGroups: ['fragrance', 'home-decor', 'home-textiles', 'smart-home', 'kitchen'],
    preferredStyles: ['home', 'warm', 'minimalist'],
  },
  'just-because': {
    preferredGroups: ['audio', 'camera', 'workspace', 'watch', 'wellness'],
    preferredStyles: ['practical', 'design', 'warm'],
  },
};
const RECIPIENT_SIGNAL_MAP = [
  { tag: 'partner', patterns: ['partner', 'boyfriend', 'girlfriend', 'wife', 'husband', 'spouse', 'fiance', 'fiancee'] },
  { tag: 'dad', patterns: ['dad', 'father', 'papa'] },
  { tag: 'mom', patterns: ['mom', 'mum', 'mother'] },
  { tag: 'brother', patterns: ['brother', 'sibling'] },
  { tag: 'sister', patterns: ['sister'] },
  { tag: 'friend', patterns: ['friend', 'best friend', 'bff'] },
  { tag: 'teacher', patterns: ['teacher', 'school teacher', 'professor', 'lecturer', 'educator', 'tutor', 'faculty'] },
  { tag: 'sibling', patterns: ['sibling', 'siblings'] },
  { tag: 'coworker', patterns: ['coworker', 'colleague', 'teammate'] },
  { tag: 'boss', patterns: ['boss', 'manager', 'mentor'] },
  { tag: 'traveler', patterns: ['travel', 'traveler', 'travels', 'flight', 'flights', 'airport', 'commute', 'commuter'] },
  { tag: 'designer', patterns: ['designer', 'design job', 'design', 'creative', 'artist'] },
  { tag: 'founder', patterns: ['founder', 'startup', 'entrepreneur'] },
  { tag: 'coffee-lover', patterns: ['coffee', 'espresso', 'latte', 'pour over', 'brew'] },
  { tag: 'fitness', patterns: ['fitness', 'gym', 'run', 'runner', 'workout', 'recovery', 'cycling'] },
  { tag: 'music-lover', patterns: ['music', 'audio', 'vinyl', 'playlist'] },
  { tag: 'gamer', patterns: ['gaming', 'gamer', 'video games', 'console', 'pc gaming', 'ps5', 'xbox'] },
  { tag: 'coder', patterns: ['coder', 'coding', 'developer', 'programmer', 'engineer'] },
  { tag: 'host', patterns: ['host', 'hosting', 'dinner party'] },
  { tag: 'homebody', patterns: ['interiors', 'decor', 'home', 'apartment', 'slow living', 'slow mornings'] },
  { tag: 'reader', patterns: ['reader', 'reads', 'reading', 'books', 'novel', 'kindle'] },
];
const STYLE_SIGNAL_MAP = [
  { tag: 'minimalist', patterns: ['minimal', 'minimalist', 'clean', 'sleek', 'understated', 'quiet luxury'] },
  { tag: 'warm', patterns: ['warm', 'cozy', 'cosy', 'slow living', 'slow mornings', 'ceramics'] },
  { tag: 'tech', patterns: ['tech', 'gadget', 'gadgets', 'smart', 'device'] },
  { tag: 'luxury', patterns: ['luxury', 'premium', 'expensive taste', 'polished', 'upscale', 'refined', 'splurge'] },
  { tag: 'desk', patterns: ['desk', 'workspace', 'office', 'setup', 'workstation'] },
  { tag: 'travel', patterns: ['travel', 'traveler', 'airport', 'carry on', 'commute'] },
  { tag: 'wellness', patterns: ['wellness', 'recovery', 'sleep', 'mindful', 'self care', 'calm'] },
  { tag: 'audio', patterns: ['audio', 'music', 'vinyl', 'headphones', 'speaker', 'earbuds'] },
  { tag: 'home', patterns: ['interiors', 'decor', 'home', 'apartment', 'hosting', 'house', 'kitchen'] },
  { tag: 'coffee', patterns: ['coffee', 'espresso', 'latte', 'pour over', 'brew', 'mug'] },
  { tag: 'design', patterns: ['design', 'designer', 'creative', 'stationery', 'sketch'] },
  { tag: 'fragrance', patterns: ['fragrance', 'perfume', 'candle', 'scent', 'aroma'] },
  { tag: 'statement', patterns: ['statement', 'bold', 'presence', 'dramatic'] },
  { tag: 'practical', patterns: ['practical', 'useful', 'utility', 'everyday'] },
  { tag: 'retro', patterns: ['retro', 'vintage'] },
  { tag: 'gaming', patterns: ['gaming', 'gamer', 'controller', 'console', 'rgb', 'playstation', 'xbox'] },
  { tag: 'books', patterns: ['books', 'book', 'reading nook', 'bookworm', 'library'] },
  { tag: 'art', patterns: ['art', 'artist', 'drawing', 'sketch', 'painting', 'illustration'] },
];
const CATEGORY_SIGNAL_MAP = [
  { tag: 'wearable-tech', patterns: ['wearable', 'smart ring', 'ring'] },
  { tag: 'audio', patterns: ['headphones', 'speaker', 'earbuds', 'record player', 'audio'] },
  { tag: 'camera', patterns: ['camera', 'instax', 'photo', 'photography'] },
  { tag: 'coffee', patterns: ['coffee', 'mug', 'espresso', 'pour over', 'brew'] },
  { tag: 'workspace', patterns: ['desk', 'office', 'mat', 'folio', 'calendar', 'lamp', 'workspace', 'writing'] },
  { tag: 'fragrance', patterns: ['perfume', 'fragrance', 'candle', 'diffuser'] },
  { tag: 'home', patterns: ['decor', 'home', 'throw', 'kitchen', 'toaster', 'succulent'] },
  { tag: 'drinkware', patterns: ['drinkware', 'mug', 'tumbler', 'flask'] },
  { tag: 'reading', patterns: ['reading', 'reader', 'book', 'books', 'kindle', 'e-reader', 'ereader'] },
  { tag: 'travel', patterns: ['travel', 'luggage', 'duffel', 'trolley', 'flight', 'carry on'] },
  { tag: 'watch', patterns: ['watch', 'timepiece'] },
  { tag: 'wellness', patterns: ['wellness', 'massage', 'recovery', 'care'] },
  { tag: 'stationery', patterns: ['journal', 'notebook', 'pen', 'recipe', 'writing'] },
  { tag: 'smart-home', patterns: ['nest hub', 'smart home', 'hub'] },
  { tag: 'gaming', patterns: ['gaming', 'controller', 'console', 'gamepad', 'rgb'] },
  { tag: 'desk-decor', patterns: ['desk decor', 'sand art', 'sculpture', 'kinetic art'] },
  { tag: 'puzzles', patterns: ['puzzle', 'logic', 'brain teaser', 'problem solving'] },
  { tag: 'art-supplies', patterns: ['sketchbook', 'drawing', 'drafting', 'markers', 'pencils'] },
];
const PRODUCT_GROUP_SIGNAL_MAP = [
  { tag: 'workspace', patterns: ['workspace accessories', 'workspace lighting', 'work accessories', 'desk mat', 'screenbar', 'folio', 'calendar', 'desk', 'workspace', 'office'] },
  { tag: 'stationery', patterns: ['stationery', 'notebook', 'journal', 'rollerball', 'writing set', 'writing instrument', 'pen'] },
  { tag: 'reading', patterns: ['reading tech', 'kindle', 'e-reader', 'ereader', 'reader', 'reading', 'book'] },
  { tag: 'coffee', patterns: ['coffee gear', 'coffee machine', 'coffee', 'espresso', 'pour over', 'brew'] },
  { tag: 'drinkware', patterns: ['drinkware', 'mug', 'tumbler', 'flask'] },
  { tag: 'travel', patterns: ['travel gear', 'travel', 'traveler', 'traveller', 'carry on', 'carry-on', 'trolley', 'duffel', 'airport'] },
  { tag: 'audio', patterns: ['audio', 'headphones', 'earbuds', 'speaker', 'record player', 'music'] },
  { tag: 'camera', patterns: ['camera', 'instax', 'photo'] },
  { tag: 'watch', patterns: ['watch', 'timepiece'] },
  { tag: 'fragrance', patterns: ['fragrance', 'perfume', 'candle', 'diffuser', 'aroma'] },
  { tag: 'home-decor', patterns: ['home decor', 'decor', 'succulent', 'zen garden'] },
  { tag: 'home-textiles', patterns: ['home textiles', 'throw', 'blanket'] },
  { tag: 'smart-home', patterns: ['smart home', 'nest hub'] },
  { tag: 'kitchen', patterns: ['kitchen appliances', 'toaster', 'countertop', 'espresso machine'] },
  { tag: 'wellness', patterns: ['wellness', 'recovery', 'massage', 'sleep'] },
  { tag: 'self-care', patterns: ['self care', 'hand care', 'shower oil', 'care set'] },
  { tag: 'everyday-carry', patterns: ['everyday carry', 'wallet'] },
  { tag: 'wearable-tech', patterns: ['wearable tech', 'smart ring', 'ring'] },
  { tag: 'gaming', patterns: ['gaming', 'controller', 'console', 'gamepad', 'desk setup'] },
  { tag: 'desk-decor', patterns: ['desk decor', 'sand art', 'sculpture', 'kinetic art', 'ambient tray'] },
  { tag: 'puzzles', patterns: ['puzzle', 'logic', 'brain teaser', 'problem solving'] },
  { tag: 'art-supplies', patterns: ['sketchbook', 'drawing', 'drafting', 'pencil set', 'technical pencil'] },
];
const INTEREST_INTENT_RULES = [
  {
    patterns: ['friend who likes math', 'likes math', 'likes maths', 'loves math', 'loves maths', 'math lover', 'maths lover', 'into math', 'into maths', 'mathematics', 'mathematical'],
    semanticTags: ['math', 'logic', 'structured'],
    interestTags: ['math', 'logic', 'desk', 'books'],
    styleTags: ['desk', 'minimalist'],
    categoryTags: ['workspace', 'stationery', 'reading', 'desk-decor', 'puzzles'],
    keywordTags: ['logic', 'geometry', 'problem solving', 'puzzle', 'notation', 'desk'],
    preferredGroups: ['workspace', 'stationery', 'reading', 'desk-decor', 'puzzles'],
    discouragedGroups: ['audio', 'wearable-tech', 'watch', 'fragrance', 'self-care'],
    discouragedStyles: ['statement', 'fragrance'],
    discouragedKeywords: ['speaker', 'earbuds', 'watch', 'perfume'],
  },
  {
    patterns: ['loves books', 'likes books', 'book lover', 'bookworm', 'loves reading', 'likes reading', 'avid reader'],
    semanticTags: ['books', 'reading', 'thoughtful'],
    interestTags: ['books', 'reading', 'teacher'],
    styleTags: ['minimalist', 'warm'],
    categoryTags: ['reading', 'workspace', 'stationery'],
    keywordTags: ['books', 'reading', 'study', 'lamp', 'journal'],
    preferredGroups: ['reading', 'workspace', 'stationery'],
    discouragedGroups: ['audio', 'gaming', 'wearable-tech'],
    discouragedStyles: ['statement'],
    discouragedKeywords: ['console', 'earbuds'],
  },
  {
    patterns: ['into fitness', 'fitness lover', 'gym lover', 'workout', 'runner', 'runner friend'],
    semanticTags: ['fitness', 'active', 'recovery'],
    interestTags: ['fitness', 'minimalist'],
    styleTags: ['wellness', 'practical'],
    categoryTags: ['wellness', 'wearable-tech', 'drinkware'],
    keywordTags: ['fitness', 'recovery', 'hydration', 'sleep'],
    preferredGroups: ['wellness', 'wearable-tech', 'drinkware'],
    discouragedGroups: ['fragrance', 'home-decor', 'puzzles'],
    discouragedStyles: ['fragrance', 'home'],
    discouragedKeywords: ['candle', 'perfume'],
  },
  {
    patterns: ['coffee lover', 'loves coffee', 'likes coffee', 'coffee obsessed', 'into coffee', 'coffee person'],
    semanticTags: ['coffee', 'ritual', 'warm'],
    interestTags: ['coffee', 'minimalist'],
    styleTags: ['coffee', 'warm'],
    categoryTags: ['coffee', 'drinkware', 'workspace'],
    keywordTags: ['coffee', 'brew', 'pour over', 'mug', 'espresso'],
    preferredGroups: ['coffee', 'drinkware', 'workspace'],
    discouragedGroups: ['watch', 'wearable-tech', 'gaming'],
    discouragedStyles: ['statement'],
    discouragedKeywords: ['watch', 'controller'],
  },
  {
    patterns: ['minimalist', 'minimal', 'clean', 'understated', 'quiet luxury'],
    semanticTags: ['minimal', 'clean', 'edited'],
    interestTags: ['minimalist'],
    styleTags: ['minimalist'],
    categoryTags: ['workspace', 'travel', 'reading'],
    keywordTags: ['minimal', 'clean', 'simple'],
    preferredGroups: ['workspace', 'travel', 'reading'],
    discouragedGroups: ['statement'],
    discouragedStyles: ['statement'],
    discouragedKeywords: ['rgb', 'flashy'],
  },
  {
    patterns: ['gamer', 'gaming', 'loves gaming', 'video games', 'console gamer', 'pc gamer', 'plays games'],
    semanticTags: ['gaming', 'play', 'immersive'],
    interestTags: ['gaming', 'tech'],
    styleTags: ['gaming', 'tech'],
    categoryTags: ['gaming', 'audio', 'workspace'],
    keywordTags: ['gaming', 'controller', 'headset', 'desk setup', 'console'],
    preferredGroups: ['gaming', 'audio', 'workspace'],
    discouragedGroups: ['fragrance', 'self-care', 'reading'],
    discouragedStyles: ['fragrance', 'warm'],
    discouragedKeywords: ['perfume', 'candle', 'book stack'],
  },
  {
    patterns: ['artist', 'art lover', 'draws', 'drawing', 'sketching', 'paints', 'creative'],
    semanticTags: ['art', 'creative', 'expressive'],
    interestTags: ['artist', 'creative', 'designer'],
    styleTags: ['art', 'design'],
    categoryTags: ['art-supplies', 'workspace', 'camera'],
    keywordTags: ['sketchbook', 'drawing', 'drafting', 'creative'],
    preferredGroups: ['art-supplies', 'workspace', 'camera'],
    discouragedGroups: ['wearable-tech', 'watch', 'self-care'],
    discouragedStyles: ['fragrance'],
    discouragedKeywords: ['watch', 'ring'],
  },
  {
    patterns: ['traveler', 'traveller', 'frequent traveler', 'frequent traveller', 'travel often', 'always traveling', 'always travelling', 'on the go'],
    semanticTags: ['travel', 'portable', 'mobile'],
    interestTags: ['traveler', 'minimalist'],
    styleTags: ['travel', 'practical', 'minimalist'],
    categoryTags: ['travel', 'audio', 'reading', 'wearable-tech'],
    keywordTags: ['travel', 'portable', 'passport', 'carry on'],
    preferredGroups: ['travel', 'audio', 'reading', 'everyday-carry', 'wearable-tech'],
    discouragedGroups: ['fragrance', 'home-decor', 'home-textiles', 'coffee'],
    discouragedStyles: ['home', 'statement'],
    discouragedKeywords: ['candle', 'throw', 'countertop', 'espresso'],
  },
  {
    patterns: ['teacher', 'school teacher', 'professor', 'lecturer', 'educator', 'tutor'],
    semanticTags: ['teacher', 'knowledge', 'thoughtful'],
    interestTags: ['teacher', 'books', 'desk'],
    styleTags: ['desk', 'practical', 'minimalist'],
    categoryTags: ['workspace', 'stationery', 'reading', 'coffee'],
    keywordTags: ['study', 'notes', 'reading', 'desk', 'lamp'],
    preferredGroups: ['workspace', 'stationery', 'reading', 'coffee'],
    discouragedGroups: ['gaming', 'fragrance', 'wearable-tech'],
    discouragedStyles: ['statement', 'fragrance'],
    discouragedKeywords: ['console', 'perfume'],
  },
  {
    patterns: ['coder', 'coding', 'developer', 'programmer', 'software engineer', 'engineer'],
    semanticTags: ['coding', 'focus', 'build'],
    interestTags: ['coder', 'desk', 'tech'],
    styleTags: ['desk', 'tech', 'minimalist'],
    categoryTags: ['workspace', 'audio', 'drinkware'],
    keywordTags: ['keyboard', 'desk setup', 'focus', 'monitor', 'lamp'],
    preferredGroups: ['workspace', 'audio', 'drinkware'],
    discouragedGroups: ['fragrance', 'home-textiles'],
    discouragedStyles: ['fragrance'],
    discouragedKeywords: ['perfume', 'throw'],
  },
  {
    patterns: ['designer', 'design', 'graphic design', 'product designer', 'ux designer'],
    semanticTags: ['design', 'visual', 'curated'],
    interestTags: ['designer', 'creative'],
    styleTags: ['design', 'minimalist'],
    categoryTags: ['workspace', 'art-supplies', 'camera'],
    keywordTags: ['design', 'sketch', 'visual', 'layout'],
    preferredGroups: ['workspace', 'art-supplies', 'camera'],
    discouragedGroups: ['self-care', 'kitchen'],
    discouragedStyles: ['fragrance'],
    discouragedKeywords: ['diffuser', 'toaster'],
  },
];
const PROFILE_INTENT_RULES = [
  {
    patterns: ['school teacher', 'teacher', 'my sir', 'sir', 'madam', 'maam', 'mentor', 'professor', 'lecturer', 'educator', 'faculty', 'tutor'],
    semanticTags: ['teacher', 'mentor', 'professional', 'thoughtful', 'education'],
    recipientTags: ['teacher', 'mentor', 'boss', 'coworker', 'reader'],
    styleTags: ['desk', 'practical', 'minimalist'],
    categoryTags: ['workspace', 'stationery', 'reading', 'coffee', 'drinkware'],
    keywordTags: ['education', 'mentor', 'professional', 'desk', 'writing', 'notebook', 'planner', 'lamp', 'reading', 'mug'],
    preferredGroups: ['workspace', 'stationery', 'reading', 'coffee', 'drinkware'],
    discouragedGroups: ['audio', 'fragrance', 'home-decor', 'home-textiles', 'kitchen', 'self-care', 'watch', 'everyday-carry', 'wearable-tech'],
    discouragedStyles: ['audio', 'fragrance', 'statement', 'home'],
    discouragedKeywords: ['record player', 'speaker', 'candle', 'diffuser', 'throw', 'wallet', 'watch', 'perfume'],
    hasClearRecipientIntent: true,
  },
  {
    patterns: ['younger brother', 'little brother', 'younger sibling', 'kid brother'],
    semanticTags: ['sibling', 'student', 'young', 'fun', 'tech'],
    recipientTags: ['brother'],
    styleTags: ['tech', 'practical'],
    categoryTags: ['gaming', 'audio', 'workspace', 'watch'],
    keywordTags: ['young', 'fun', 'tech', 'music', 'gaming', 'desk setup'],
    preferredGroups: ['gaming', 'audio', 'workspace', 'watch'],
    discouragedGroups: ['fragrance', 'home-decor', 'home-textiles', 'kitchen', 'self-care'],
    discouragedStyles: ['fragrance', 'warm', 'home'],
    discouragedKeywords: ['candle', 'diffuser', 'throw'],
    hasClearRecipientIntent: true,
  },
  {
    patterns: ['creative sibling', 'creative brother', 'creative sister', 'artistic sibling'],
    semanticTags: ['creative', 'art', 'design', 'expressive'],
    recipientTags: ['brother', 'sister', 'designer'],
    interestTags: ['artist', 'creative', 'designer'],
    styleTags: ['design', 'art', 'desk'],
    categoryTags: ['workspace', 'art-supplies', 'camera', 'desk-decor'],
    keywordTags: ['sketchbook', 'creative', 'desk', 'hobby', 'drawing', 'design'],
    preferredGroups: ['workspace', 'art-supplies', 'camera', 'desk-decor'],
    discouragedGroups: ['wearable-tech', 'gaming', 'watch', 'fragrance'],
    discouragedStyles: ['fragrance', 'gaming'],
    discouragedKeywords: ['controller', 'console', 'perfume', 'ring'],
    hasClearRecipientIntent: true,
  },
  {
    patterns: ['minimalist frequent traveler', 'minimalist traveler', 'frequent traveler minimalist', 'minimal traveler'],
    semanticTags: ['traveler', 'minimal', 'edited carry'],
    recipientTags: ['traveler'],
    interestTags: ['minimalist', 'traveler'],
    styleTags: ['minimalist', 'travel', 'practical'],
    categoryTags: ['travel', 'reading', 'everyday-carry', 'workspace'],
    keywordTags: ['compact', 'carry on', 'passport', 'packing', 'portable'],
    preferredGroups: ['travel', 'reading', 'everyday-carry', 'workspace'],
    discouragedGroups: ['home-decor', 'home-textiles', 'kitchen', 'fragrance', 'gaming'],
    discouragedStyles: ['home', 'warm', 'statement', 'gaming'],
    discouragedKeywords: ['candle', 'throw', 'toaster', 'controller'],
    hasClearRecipientIntent: true,
  },
  {
    patterns: ['frequent traveler', 'travels often', 'travel often', 'always travelling', 'always traveling', 'on the go', 'airport', 'carry on', 'carry-on', 'commute', 'commuter', 'traveler', 'traveller'],
    semanticTags: ['traveler', 'portable', 'practical'],
    recipientTags: ['traveler'],
    styleTags: ['travel', 'practical', 'minimalist'],
    categoryTags: ['travel', 'audio', 'reading', 'wearable-tech'],
    keywordTags: ['portable', 'travel', 'carry on', 'commute', 'passport'],
    preferredGroups: ['travel', 'audio', 'reading', 'everyday-carry', 'wearable-tech'],
    discouragedGroups: ['fragrance', 'home-decor', 'home-textiles', 'kitchen', 'coffee'],
    discouragedStyles: ['home', 'fragrance', 'warm'],
    discouragedKeywords: ['candle', 'diffuser', 'throw', 'toaster', 'espresso'],
    hasClearRecipientIntent: true,
  },
  {
    patterns: ['minimalist', 'minimal', 'clean', 'sleek', 'understated', 'quiet luxury'],
    semanticTags: ['minimal', 'clean', 'elegant'],
    recipientTags: [],
    styleTags: ['minimalist'],
    categoryTags: [],
    keywordTags: ['clean', 'elegant', 'minimal'],
    preferredGroups: [],
    discouragedGroups: [],
    discouragedStyles: ['statement'],
    discouragedKeywords: [],
    hasClearRecipientIntent: false,
  },
  {
    patterns: ['promotion win', 'promoted', 'promotion', 'new role', 'new job', 'raise', 'achievement'],
    semanticTags: ['professional', 'achievement', 'desk', 'premium'],
    recipientTags: ['boss', 'coworker', 'founder'],
    styleTags: ['desk', 'practical', 'minimalist'],
    categoryTags: ['workspace', 'stationery', 'travel', 'coffee'],
    keywordTags: ['professional', 'achievement', 'desk', 'premium'],
    preferredGroups: ['workspace', 'stationery', 'travel', 'coffee'],
    discouragedGroups: ['fragrance', 'home-decor', 'home-textiles', 'kitchen'],
    discouragedStyles: ['home', 'warm'],
    discouragedKeywords: ['candle', 'diffuser', 'throw'],
    hasClearRecipientIntent: true,
  },
];

const PHASE_B_PHRASE_EXPANSIONS = [
  {
    patterns: ['for my sir', 'my sir', 'class sir', 'school sir', 'sir who teaches'],
    recipientTags: ['teacher', 'mentor'],
    interestTags: ['books', 'reading'],
    keywordTags: ['classroom', 'notes', 'professional', 'desk', 'writing'],
  },
  {
    patterns: ['younger brother', 'little brother', 'kid brother', 'young brother'],
    recipientTags: ['brother'],
    interestTags: ['gaming', 'tech'],
    styleTags: ['gaming', 'tech'],
    keywordTags: ['young', 'fun', 'desk setup', 'accessories'],
  },
  {
    patterns: ['school teacher', 'for teacher', 'for my teacher', 'my teacher'],
    recipientTags: ['teacher'],
    interestTags: ['books', 'reading'],
    keywordTags: ['classroom', 'grading', 'planner', 'stationery', 'desk lamp'],
  },
  {
    patterns: ['creative sibling', 'artistic sibling', 'design sibling'],
    recipientTags: ['brother', 'sister', 'designer'],
    interestTags: ['artist', 'creative', 'designer'],
    keywordTags: ['sketchbook', 'hobby', 'desk', 'portfolio'],
  },
];

function applyPhaseBPhraseExpansions(rawText, mergedSignals) {
  const haystack = normalizeSearchText(rawText);
  if (!haystack) {
    return mergedSignals;
  }

  const next = { ...mergedSignals, badFit: { ...mergedSignals.badFit } };

  PHASE_B_PHRASE_EXPANSIONS.forEach((rule) => {
    if (!rule.patterns.some((p) => haystack.includes(normalizeSearchText(p)))) {
      return;
    }
    next.recipientTags = unique([...(next.recipientTags || []), ...(rule.recipientTags || [])]);
    next.interestTags = unique([...(next.interestTags || []), ...(rule.interestTags || [])]);
    next.styleTags = unique([...(next.styleTags || []), ...(rule.styleTags || [])]);
    next.categoryTags = unique([...(next.categoryTags || []), ...(rule.categoryTags || [])]);
    next.keywordTags = unique([...(next.keywordTags || []), ...(rule.keywordTags || [])]);
    next.preferredGroups = unique([...(next.preferredGroups || []), ...(rule.preferredGroups || [])]);
    next.semanticTags = unique([...(next.semanticTags || []), ...(rule.semanticTags || [])]);
    if (rule.badFit) {
      next.badFit.groups = unique([...(next.badFit.groups || []), ...(rule.badFit.groups || [])]);
      next.badFit.styles = unique([...(next.badFit.styles || []), ...(rule.badFit.styles || [])]);
      next.badFit.keywords = unique([...(next.badFit.keywords || []), ...(rule.badFit.keywords || [])]);
    }
  });

  if (/\bsibling\b/.test(haystack)) {
    next.recipientTags = unique([...(next.recipientTags || []), 'brother', 'sister', 'sibling']);
  }

  if (/\bmath\b|\bmaths\b|\bmathematics\b/.test(haystack)) {
    next.interestTags = unique([...(next.interestTags || []), 'math', 'logic']);
    next.categoryTags = unique([...(next.categoryTags || []), 'puzzles', 'stationery', 'reading']);
    next.preferredGroups = unique([...(next.preferredGroups || []), 'puzzles', 'stationery', 'reading', 'desk-decor']);
  }

  const roleRecipientTags = new Set(['teacher', 'brother', 'sister', 'partner', 'friend', 'dad', 'mom', 'boss', 'coworker', 'traveler', 'designer', 'mentor']);
  next.hasClearRecipientIntent = Boolean(
    mergedSignals.hasClearRecipientIntent
    || (next.recipientTags || []).some((t) => roleRecipientTags.has(t)),
  );

  return next;
}

function derivePrimaryIntentClusters(context) {
  const clusters = [];
  const rt = context.recipientTags || [];
  const it = context.interestTags || [];
  const st = context.styleTags || [];
  const raw = normalizeSearchText(context.rawProfile || '');

  if (rt.includes('teacher') || raw.includes('teacher') || raw.includes('school')) {
    clusters.push('teacher');
  }
  if (it.includes('math') || raw.includes('math')) {
    clusters.push('math');
  }
  if (it.includes('gaming') || st.includes('gaming') || raw.includes('gaming') || raw.includes('gamer')) {
    clusters.push('gaming');
  }
  if (it.includes('coffee') || raw.includes('coffee') || raw.includes('espresso')) {
    clusters.push('coffee');
  }
  if (rt.includes('traveler') || it.includes('traveler') || (st.includes('travel') && st.includes('minimalist'))) {
    clusters.push('travel_minimal');
  }
  if (it.includes('artist') || it.includes('creative') || rt.includes('designer')) {
    clusters.push('creative');
  }

  return unique(clusters);
}

function buildNormalizedIntent(contextBase) {
  const clusters = derivePrimaryIntentClusters(contextBase);
  const budgetTier = contextBase.priceSensitivity === 'budget'
    ? 'budget'
    : contextBase.priceSensitivity === 'premium' ? 'premium' : 'balanced';

  return {
    recipientType: contextBase.recipientType || '',
    recipientTags: unique(contextBase.recipientTags || []),
    interestTags: unique(contextBase.interestTags || []),
    styleTags: unique(contextBase.styleTags || []),
    occasion: contextBase.occasion || '',
    budgetTier,
    luxuryPreference: Boolean(contextBase.luxurySelected),
    avoidTags: unique(contextBase.avoidTags || []),
    confidenceScore: Number(contextBase.confidence) || 0,
    primaryIntentClusters: clusters,
  };
}

function computeIntentClusterAlignment(product, context) {
  const groups = getProductGroupTags(product);
  const roleHits = countMatches(product.recipientTags, context.recipientTags);
  const interestHits = countMatches(product.interestTags, context.interestTags);
  const groupHits = countMatches(groups, context.preferredGroups);
  const categoryHits = countCategoryMatches(product, context.categoryTags);
  const keywordHits = scoreKeywordMatches(getProductSearchText(product), context.keywordTags, 3, 1, 14);

  return (roleHits * 22)
    + (interestHits * 18)
    + (groupHits * 14)
    + (categoryHits * 10)
    + keywordHits;
}

function computeIntentMismatchPenalty(product, context) {
  let penalty = 0;
  const clusters = context.normalizedIntent?.primaryIntentClusters || [];
  const groups = getProductGroupTags(product);
  const interests = product.interestTags || [];
  const styles = product.styleTags || [];

  if (clusters.includes('teacher')) {
    if (groups.includes('gaming') || interests.includes('gaming') || styles.includes('gaming')) {
      penalty -= 55;
    }
    if (groups.includes('fragrance') && !interests.includes('wellness')) {
      penalty -= 28;
    }
  }

  if (clusters.includes('math')) {
    if (groups.includes('gaming') && !groups.includes('puzzles') && !interests.includes('math')) {
      penalty -= 48;
    }
    if (groups.includes('audio') && !interests.includes('math')) {
      penalty -= 22;
    }
  }

  if (clusters.includes('gaming')) {
    if (groups.includes('fragrance') || interests.includes('homebody')) {
      penalty -= 25;
    }
  }

  if (clusters.includes('travel_minimal')) {
    if (groups.includes('home-decor') || groups.includes('kitchen') || groups.includes('fragrance')) {
      penalty -= 40;
    }
    if (groups.includes('gaming') && !interests.includes('gaming')) {
      penalty -= 30;
    }
  }

  if (clusters.includes('coffee')) {
    if (groups.includes('gaming') && !interests.includes('gaming')) {
      penalty -= 35;
    }
  }

  if (clusters.includes('creative')) {
    if (groups.includes('gaming') && !interests.includes('gaming')) {
      penalty -= 40;
    }
  }

  return penalty;
}

const COMMON_PROFILE_TOKENS = new Set([
  'about',
  'after',
  'also',
  'and',
  'buys',
  'feel',
  'first',
  'from',
  'got',
  'have',
  'just',
  'likes',
  'love',
  'loves',
  'that',
  'their',
  'they',
  'them',
  'these',
  'thing',
  'things',
  'thoughtful',
  'very',
  'with',
  'without',
]);
const CLARIFY_FALLBACK_IMAGE = '/minimal_desk.png';

const VERIFIED_PRODUCT_CATALOG = [
  {
    id: 'ember-mug-2',
    type: 'verified',
    title: 'Ember Mug 2',
    brand: 'Ember',
    category: 'Coffee Gear',
    description: 'A temperature-controlled mug that feels genuinely useful for coffee lovers, teachers, and anyone who spends long hours at a desk.',
    image: '/modern_coffee_mug.png',
    recipientTags: ['friend', 'teacher', 'coworker', 'boss', 'coffee-lover'],
    interestTags: ['coffee', 'teacher', 'coder', 'minimalist'],
    styleTags: ['coffee', 'desk', 'tech', 'minimalist'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    imageTags: ['ember', 'mug', 'coffee', 'temperature control'],
    searchTerm: 'Ember Mug 2',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Ember+Mug+2',
      flipkart: 'https://www.flipkart.com/search?q=Ember%20Mug%202',
    },
    marketplacePrices: {
      amazon: 11999,
      flipkart: 12190,
    },
    validationStatus: 'verified',
  },
  {
    id: 'orbitkey-desk-mat',
    type: 'verified',
    title: 'Orbitkey Desk Mat',
    brand: 'Orbitkey',
    category: 'Workspace Accessories',
    description: 'A clean desk mat that lands especially well for focused work, study sessions, gaming setups, and neat minimalist desks.',
    image: '/desk_mat_mock.png',
    recipientTags: ['teacher', 'friend', 'coworker', 'designer', 'gamer', 'coder'],
    interestTags: ['math', 'teacher', 'coder', 'designer', 'gamer', 'minimalist'],
    styleTags: ['desk', 'minimalist', 'design', 'practical'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    imageTags: ['orbitkey', 'desk mat', 'keyboard', 'workspace'],
    searchTerm: 'Orbitkey Desk Mat',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Orbitkey+Desk+Mat',
      flipkart: 'https://www.flipkart.com/search?q=Orbitkey%20Desk%20Mat',
    },
    marketplacePrices: {
      amazon: 8990,
      flipkart: 8790,
    },
    validationStatus: 'verified',
  },
  {
    id: 'yankee-candle-jar',
    type: 'verified',
    title: 'Yankee Candle Classic Jar',
    brand: 'Yankee Candle',
    category: 'Home Fragrance',
    description: 'A reliable, giftable classic when you want something warm and universally liked without guessing exact sizes.',
    image: '/candle_mock.png',
    recipientTags: ['friend', 'partner', 'mom', 'coworker', 'teacher'],
    interestTags: ['home', 'fragrance', 'reading', 'coffee'],
    styleTags: ['warm', 'home', 'fragrance'],
    occasionTags: ['birthday', 'anniversary', 'housewarming', 'just-because'],
    imageTags: ['candle', 'jar', 'fragrance'],
    searchTerm: 'Yankee Candle classic jar',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Yankee+Candle+classic+jar',
      flipkart: 'https://www.flipkart.com/search?q=Yankee%20Candle%20classic%20jar',
    },
    marketplacePrices: {
      amazon: 2299,
      flipkart: 2499,
    },
    validationStatus: 'verified',
  },
  {
    id: 'sony-wh-ch520',
    type: 'verified',
    title: 'Sony WH-CH520 Wireless Headphones',
    brand: 'Sony',
    category: 'Audio',
    description: 'A practical everyday wireless headphone pick with strong battery life for commute, study, and casual gaming.',
    image: '/headphones_mock.png',
    recipientTags: ['brother', 'friend', 'traveler', 'student', 'gamer'],
    interestTags: ['gaming', 'music', 'traveler', 'student'],
    styleTags: ['audio', 'tech', 'practical'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    imageTags: ['headphones', 'wireless', 'audio'],
    searchTerm: 'Sony WH-CH520',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Sony+WH-CH520',
      flipkart: 'https://www.flipkart.com/search?q=Sony%20WH-CH520',
    },
    marketplacePrices: {
      amazon: 4499,
      flipkart: 4299,
    },
    validationStatus: 'verified',
  },
  {
    id: 'casio-vintage-a168',
    type: 'verified',
    title: 'Casio Vintage A168 Digital Watch',
    brand: 'Casio',
    category: 'Watches',
    description: 'A classic, low-risk style gift that feels nostalgic, practical, and easy to wear daily.',
    image: '/matte_watch.png',
    recipientTags: ['brother', 'friend', 'dad', 'coworker'],
    interestTags: ['minimalist', 'travel', 'practical'],
    styleTags: ['minimalist', 'practical'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    imageTags: ['watch', 'digital', 'steel'],
    searchTerm: 'Casio A168 watch',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Casio+A168+watch',
      flipkart: 'https://www.flipkart.com/search?q=Casio%20A168%20watch',
      myntra: 'https://www.myntra.com/casio-a168',
    },
    marketplacePrices: {
      amazon: 2495,
      flipkart: 2399,
    },
    validationStatus: 'verified',
  },
  {
    id: 'secrid-slimwallet',
    type: 'verified',
    title: 'Secrid Slimwallet',
    brand: 'Secrid',
    category: 'Everyday Carry',
    description: 'A compact wallet that feels premium, practical, and genuinely useful for minimalist everyday carry.',
    image: '/sleek_wallet.png',
    recipientTags: ['partner', 'friend', 'brother', 'traveler'],
    interestTags: ['traveler', 'minimalist', 'practical'],
    styleTags: ['minimalist', 'travel', 'practical'],
    occasionTags: ['birthday', 'anniversary', 'just-because'],
    imageTags: ['wallet', 'leather', 'card holder'],
    searchTerm: 'Secrid Slimwallet',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=Secrid+Slimwallet',
    },
    marketplacePrices: {},
    validationStatus: 'verified',
  },
].map((product) => buildRenderableProduct(product)).filter(Boolean);

const CONCEPT_GIFT_CATALOG = [
  // COFFEE & DRINKWARE
  {
    id: 'teacher-mug', type: 'concept', title: 'Customized "Best Teacher" Coffee Mug', category: 'Personalized Gift', description: 'A daily useful gift to show appreciation.', tags: ['mug', 'practical', 'teacher', 'simple', 'budget'], recipientTags: ['teacher', 'mentor', 'coworker'], interestTags: ['coffee', 'tea'], styleTags: ['practical', 'simple'], occasionTags: ['birthday', 'just-because'], image: '/modern_coffee_mug.png'
  },
  {
    id: 'dad-mug', type: 'concept', title: 'Classic Dad Coffee Mug', category: 'Home', description: 'A sturdy mug for his morning routine.', tags: ['mug', 'practical', 'dad', 'budget'], recipientTags: ['dad', 'father', 'grandfather'], interestTags: ['coffee'], styleTags: ['practical', 'simple'], occasionTags: ['birthday', 'just-because'], image: '/modern_coffee_mug.png'
  },
  {
    id: 'couple-mug', type: 'concept', title: 'Couples Matching Mug Set', category: 'Home', description: 'A beautiful morning ritual for two.', tags: ['mug', 'couple', 'anniversary', 'partner'], recipientTags: ['partner', 'girlfriend', 'boyfriend', 'wife', 'husband'], interestTags: ['coffee', 'homebody'], styleTags: ['romantic', 'decorative'], occasionTags: ['anniversary', 'housewarming'], image: '/modern_coffee_mug.png'
  },

  // CANDLES & FRAGRANCE
  {
    id: 'spa-candle', type: 'concept', title: 'Aromatherapy Spa Candle', category: 'Self Care', description: 'For unwinding after a long day at work.', tags: ['candle', 'spa', 'relaxing', 'mom', 'teacher'], recipientTags: ['mom', 'mother', 'teacher', 'friend', 'sister'], interestTags: ['wellness', 'homebody'], styleTags: ['relaxing', 'practical'], occasionTags: ['birthday', 'just-because'], image: '/candle_mock.png'
  },
  {
    id: 'romantic-candle', type: 'concept', title: 'Luxury Romantic Soy Candle', category: 'Home Fragrance', description: 'Sets a beautiful, calming mood in any room.', tags: ['candle', 'romantic', 'luxury', 'decorative'], recipientTags: ['girlfriend', 'ex-girlfriend', 'wife', 'partner'], interestTags: ['homebody', 'design'], styleTags: ['decorative', 'luxury', 'romantic'], occasionTags: ['anniversary', 'birthday', 'housewarming'], image: '/candle_mock.png'
  },
  {
    id: 'floral-perfume', type: 'concept', title: 'Elegant Floral Perfume', category: 'Fragrance', description: 'A luxurious scent for everyday wear.', tags: ['perfume', 'luxury', 'decorative'], recipientTags: ['mom', 'wife', 'girlfriend', 'ex-girlfriend', 'sister'], interestTags: ['fashion', 'beauty'], styleTags: ['luxury', 'decorative'], occasionTags: ['birthday', 'anniversary'], image: '/elegant_perfume.png'
  },
  {
    id: 'signature-cologne', type: 'concept', title: 'Signature Wood Cologne', category: 'Fragrance', description: 'A deep, musky everyday fragrance.', tags: ['cologne', 'luxury'], recipientTags: ['dad', 'husband', 'boyfriend', 'brother'], interestTags: ['fashion'], styleTags: ['luxury'], occasionTags: ['birthday', 'promotion'], image: '/elegant_perfume.png'
  },

  // WALLETS & EDC
  {
    id: 'classic-leather-wallet', type: 'concept', title: 'Classic Leather Wallet', category: 'Accessories', description: 'A timeless, practical essential.', tags: ['wallet', 'leather', 'practical'], recipientTags: ['dad', 'brother', 'boyfriend', 'husband', 'friend'], interestTags: ['minimalist'], styleTags: ['practical', 'minimalist'], occasionTags: ['birthday', 'promotion', 'just-because'], image: '/sleek_wallet.png'
  },
  {
    id: 'premium-cardholder', type: 'concept', title: 'Minimalist Cardholder', category: 'Accessories', description: 'For the guy who hates bulky pockets.', tags: ['wallet', 'minimalist', 'practical'], recipientTags: ['brother', 'friend', 'coder', 'coworker'], interestTags: ['minimalist', 'traveler'], styleTags: ['practical', 'minimalist'], occasionTags: ['birthday', 'just-because'], image: '/sleek_wallet.png'
  },

  // WATCHES & WEARABLES
  {
    id: 'rose-gold-watch', type: 'concept', title: 'Classic Rose Gold Watch', category: 'Jewelry', description: 'A timeless, elegant accessory.', tags: ['watch', 'luxury', 'decorative', 'jewelry'], recipientTags: ['mom', 'wife', 'girlfriend', 'sister'], interestTags: ['fashion', 'design'], styleTags: ['luxury', 'decorative'], occasionTags: ['birthday', 'anniversary', 'promotion'], image: '/luxury_watch.png'
  },
  {
    id: 'chrono-watch', type: 'concept', title: 'Premium Chronograph Watch', category: 'Accessories', description: 'A striking statement piece for his wrist.', tags: ['watch', 'luxury', 'statement'], recipientTags: ['dad', 'husband', 'boyfriend', 'brother'], interestTags: ['fashion'], styleTags: ['luxury', 'decorative'], occasionTags: ['birthday', 'promotion', 'anniversary'], image: '/luxury_watch.png'
  },
  {
    id: 'fitness-smartwatch', type: 'concept', title: 'Minimalist Smartwatch', category: 'Wearable Tech', description: 'Perfect for tracking runs and notifications.', tags: ['watch', 'tech', 'fitness', 'practical'], recipientTags: ['brother', 'boyfriend', 'friend', 'traveler'], interestTags: ['fitness', 'tech', 'traveler'], styleTags: ['practical', 'minimalist'], occasionTags: ['birthday', 'promotion'], image: '/matte_watch.png'
  },
  {
    id: 'smart-ring', type: 'concept', title: 'Fitness Tracking Smart Ring', category: 'Wearable Tech', description: 'Sleek, screen-free health tracking.', tags: ['ring', 'tech', 'fitness', 'luxury'], recipientTags: ['partner', 'husband', 'wife', 'tech-lover'], interestTags: ['fitness', 'tech', 'minimalist'], styleTags: ['luxury', 'practical', 'minimalist'], occasionTags: ['birthday', 'anniversary'], image: '/smart_ring_mock.png'
  },

  // DESK & WORKSPACE
  {
    id: 'wooden-desk-organizer', type: 'concept', title: 'Wooden Desk Organizer', category: 'Workspace', description: 'Keeps their desk minimal and tidy.', tags: ['desk', 'practical', 'wood'], recipientTags: ['teacher', 'boss', 'coworker', 'dad'], interestTags: ['minimalist', 'office'], styleTags: ['practical', 'minimalist'], occasionTags: ['promotion', 'just-because', 'birthday'], image: '/minimal_desk.png'
  },
  {
    id: 'student-desk-kit', type: 'concept', title: 'Minimalist Study Kit', category: 'Workspace', description: 'Everything they need for a focused study session.', tags: ['desk', 'practical', 'student'], recipientTags: ['kid', 'teen', 'brother', 'sister', 'student'], interestTags: ['minimalist', 'coding', 'books', 'math', 'logic'], styleTags: ['practical', 'minimalist'], occasionTags: ['birthday', 'just-because'], image: '/minimal_desk.png'
  },
  {
    id: 'leather-desk-mat', type: 'concept', title: 'Premium Leather Desk Mat', category: 'Workspace', description: 'A luxurious upgrade for their everyday setup.', tags: ['desk', 'leather', 'practical', 'luxury'], recipientTags: ['coder', 'gamer', 'boyfriend', 'brother', 'designer'], interestTags: ['gaming', 'coding', 'minimalist'], styleTags: ['practical', 'luxury', 'minimalist'], occasionTags: ['birthday', 'promotion'], image: '/desk_mat_mock.png'
  },
  {
    id: 'aesthetic-desk-mat', type: 'concept', title: 'Aesthetic Workspace Mat', category: 'Workspace', description: 'Adds a soft touch of design to any desk.', tags: ['desk', 'decorative', 'design'], recipientTags: ['girlfriend', 'designer', 'sister', 'coworker'], interestTags: ['design', 'art', 'minimalist'], styleTags: ['decorative', 'minimalist'], occasionTags: ['birthday', 'just-because'], image: '/desk_mat_mock.png'
  },

  // TECH & AUDIO
  {
    id: 'wireless-headphones', type: 'concept', title: 'Wireless Focus Audio Headphones', category: 'Tech', description: 'For deep work, commuting, or relaxation.', tags: ['headphones', 'tech', 'audio', 'practical'], recipientTags: ['traveler', 'coder', 'student', 'brother', 'friend', 'teen'], interestTags: ['music', 'traveler', 'coding'], styleTags: ['practical', 'tech'], occasionTags: ['birthday', 'promotion'], image: '/headphones_mock.png'
  },

  // UNIQUE & DECORATIVE
  {
    id: 'kinetic-sand-art', type: 'concept', title: 'Calming Kinetic Sand Art', category: 'Decor', description: 'A mesmerizing, constantly changing desk piece.', tags: ['art', 'decorative', 'desk', 'unique'], recipientTags: ['teacher', 'boss', 'coworker', 'designer', 'friend'], interestTags: ['art', 'design', 'minimalist'], styleTags: ['decorative', 'unique'], occasionTags: ['housewarming', 'birthday', 'just-because'], image: '/zen_garden.png'
  },
  {
    id: 'bonsai-zen-garden', type: 'concept', title: 'Desktop Bonsai & Zen Decor', category: 'Decor', description: 'A symbol of growth, peace, and patience.', tags: ['plant', 'decorative', 'zen'], recipientTags: ['mom', 'teacher', 'friend', 'grandparent'], interestTags: ['nature', 'homebody', 'wellness'], styleTags: ['decorative', 'relaxing'], occasionTags: ['housewarming', 'birthday'], image: '/zen_garden.png'
  },

  // HAMPERS & GENERAL
  {
    id: 'premium-hamper', type: 'concept', title: 'Premium Curated Gift Hamper', category: 'Hamper', description: 'A beautifully packaged box of treats and goodies.', tags: ['hamper', 'group', 'luxury', 'generic'], recipientTags: ['boss', 'coworker', 'family', 'friend'], interestTags: ['food', 'homebody'], styleTags: ['luxury', 'decorative'], occasionTags: ['housewarming', 'anniversary', 'birthday'], image: '/ai_gift_box.png'
  },
  {
    id: 'photo-frame-box', type: 'concept', title: 'Custom Photo Memory Box', category: 'Personalized', description: 'To cherish the best memories forever.', tags: ['photo', 'personalized', 'sentimental'], recipientTags: ['mom', 'dad', 'grandparent', 'partner'], interestTags: ['family', 'homebody'], styleTags: ['sentimental', 'decorative'], occasionTags: ['anniversary', 'birthday'], image: '/ai_gift_box.png'
  },
  {
    id: 'birthday-surprise-box', type: 'concept', title: 'Surprise Birthday Party Box', category: 'Party', description: 'Packed with fun, snacks, and celebration vibes.', tags: ['box', 'fun', 'party'], recipientTags: ['friend', 'sibling', 'teen', 'kid', 'girlfriend', 'boyfriend'], interestTags: ['fun', 'games'], styleTags: ['fun', 'practical'], occasionTags: ['birthday'], image: '/ai_gift_box.png'
  },
  {
    id: 'logic-puzzle-desk-sphere',
    type: 'concept',
    title: 'Mechanical Logic Puzzle Sphere',
    category: 'Desk Puzzle',
    description: 'A tactile desk puzzle that feels clever without feeling childish—great for math-minded friends who like quiet focus breaks.',
    tags: ['puzzle', 'logic', 'desk', 'clever'],
    recipientTags: ['friend', 'teacher', 'brother', 'sister'],
    interestTags: ['math', 'logic', 'creative'],
    styleTags: ['minimalist', 'desk', 'practical'],
    occasionTags: ['birthday', 'just-because', 'promotion'],
    image: '/zen_garden.png',
  },
  {
    id: 'symbolic-infinity-art-print',
    type: 'concept',
    title: 'Symbolic Infinity Desk Art Print',
    category: 'Desk Decor',
    description: 'A framed minimalist print with a subtle mathematical motif—clean enough for a desk, personal enough for a thoughtful gift.',
    tags: ['math', 'symbolic', 'desk', 'art'],
    recipientTags: ['friend', 'teacher', 'partner'],
    interestTags: ['math', 'design', 'minimalist'],
    styleTags: ['minimalist', 'design', 'desk'],
    occasionTags: ['birthday', 'anniversary', 'just-because'],
    image: '/minimal_desk.png',
  },
  {
    id: 'pour-over-coffee-starter-kit',
    type: 'concept',
    title: 'Pour-Over Coffee Starter Kit',
    category: 'Coffee Ritual',
    description: 'A compact pour-over setup for someone who treats coffee like a ritual—warm, practical, and desk-friendly.',
    tags: ['coffee', 'brew', 'ritual', 'desk'],
    recipientTags: ['friend', 'coworker', 'partner', 'teacher'],
    interestTags: ['coffee', 'minimalist'],
    styleTags: ['coffee', 'warm', 'practical'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    image: '/modern_coffee_mug.png',
  },
  {
    id: 'compact-travel-tech-pouch',
    type: 'concept',
    title: 'Compact Travel Tech Pouch',
    category: 'Travel Accessories',
    description: 'A slim organizer for cables, adapters, and earbuds—built for frequent flyers who pack light.',
    tags: ['travel', 'compact', 'tech', 'edc'],
    recipientTags: ['traveler', 'friend', 'coworker'],
    interestTags: ['traveler', 'minimalist', 'tech'],
    styleTags: ['travel', 'minimalist', 'practical'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    image: '/sleek_wallet.png',
  },
  {
    id: 'desk-rgb-accent-light-strip',
    type: 'concept',
    title: 'Minimal RGB Desk Accent Light',
    category: 'Gaming Desk',
    description: 'A low-profile bias light for late-night sessions—fun without turning the whole room into a disco.',
    tags: ['gaming', 'desk', 'rgb', 'accessory'],
    recipientTags: ['brother', 'friend', 'teen'],
    interestTags: ['gaming', 'tech'],
    styleTags: ['gaming', 'tech', 'desk'],
    occasionTags: ['birthday', 'just-because'],
    image: '/minimal_desk.png',
  },
  {
    id: 'creative-sketch-journal-set',
    type: 'concept',
    title: 'Creative Sketch Journal Set',
    category: 'Art & Stationery',
    description: 'A premium sketch journal with a few curated pencils—made for siblings who doodle, design, and think visually.',
    tags: ['sketch', 'journal', 'creative', 'stationery'],
    recipientTags: ['sister', 'brother', 'friend', 'designer'],
    interestTags: ['artist', 'creative', 'designer'],
    styleTags: ['design', 'art', 'desk'],
    occasionTags: ['birthday', 'promotion', 'just-because'],
    image: '/minimal_desk.png',
  },
].map((idea) => buildRenderableConcept(idea)).filter(Boolean);

const GIFT_ENGINE_CATALOG = [...VERIFIED_PRODUCT_CATALOG, ...CONCEPT_GIFT_CATALOG];
const DEFAULT_RECOMMENDATIONS = pickDiverseProducts(GIFT_ENGINE_CATALOG, 6).map((item) => buildRenderableGiftItem(item) || item).filter(Boolean);

const CURATED_COLLECTIONS = {
  'desk-rituals': buildRenderableConcept({
    id: 'curated-all-occasion-perfume',
    type: 'concept',
    title: 'Luxury Unisex Perfume Gift Set',
    category: 'Fragrance',
    description: 'A versatile premium fragrance suitable for any occasion and any person.',
    reasoning: 'product photo, isolated background',
    tags: ['perfume', 'all occasion', 'gift set'],
    recipientTags: ['friend', 'partner', 'family'],
    interestTags: ['fragrance', 'style'],
    styleTags: ['premium', 'versatile'],
    occasionTags: ['birthday', 'anniversary', 'just-because'],
    imageTags: ['perfume', 'bottle', 'gift set'],
    image: '/perfume.png',
    imageSearchQuery: 'Luxury Unisex Perfume Gift Set product photo isolated background',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=unisex+perfume+gift+set',
      flipkart: 'https://www.flipkart.com/search?q=unisex+perfume',
      meesho: 'https://www.meesho.com/search?q=perfume+gift',
      myntra: 'https://www.myntra.com/perfume',
    },
    marketplacePrices: {
      amazon: 549,
      flipkart: 599,
      meesho: 499,
      myntra: 649,
    },
    validationStatus: 'concept',
  }),
  'evening-energy': buildRenderableConcept({
    id: 'curated-all-occasion-wallet',
    type: 'concept',
    title: 'Premium Leather Wallet',
    category: 'Accessories',
    description: 'A stylish everyday essential that works as a practical and elegant gift.',
    reasoning: 'product photo, isolated background',
    tags: ['wallet', 'leather', 'everyday carry'],
    recipientTags: ['friend', 'partner', 'family'],
    interestTags: ['minimalist', 'practical'],
    styleTags: ['elegant', 'practical'],
    occasionTags: ['birthday', 'anniversary', 'just-because'],
    imageTags: ['wallet', 'leather'],
    image: '/wallet.png',
    imageSearchQuery: 'Premium Leather Wallet product photo isolated background',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=leather+wallet',
      flipkart: 'https://www.flipkart.com/search?q=leather+wallet',
      meesho: 'https://www.meesho.com/search?q=wallet',
      myntra: 'https://www.myntra.com/wallet',
    },
    marketplacePrices: {
      amazon: 649,
      flipkart: 699,
      meesho: 599,
      myntra: 749,
    },
    validationStatus: 'concept',
  }),
  'quiet-luxury': buildRenderableConcept({
    id: 'curated-all-occasion-plant',
    type: 'concept',
    title: 'Indoor Plant Gift Set',
    category: 'Home Decor',
    description: 'A meaningful and calming gift that symbolizes growth and positivity.',
    reasoning: 'product photo, isolated background',
    tags: ['plant', 'home', 'calming'],
    recipientTags: ['friend', 'family', 'coworker'],
    interestTags: ['nature', 'home'],
    styleTags: ['calming', 'meaningful'],
    occasionTags: ['birthday', 'housewarming', 'just-because'],
    imageTags: ['plant', 'indoor', 'gift'],
    image: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1400&q=80',
    imageSearchQuery: 'Indoor Plant Gift Set product photo isolated background',
    marketplaceLinks: {
      amazon: 'https://www.amazon.in/s?k=indoor+plants+gift',
      flipkart: 'https://www.flipkart.com/search?q=indoor+plants',
      meesho: 'https://www.meesho.com/search?q=plant+gift',
      myntra: 'https://www.myntra.com/plant',
    },
    marketplacePrices: {
      amazon: 699,
      flipkart: 749,
      meesho: 649,
      myntra: 799,
    },
    validationStatus: 'concept',
  }),
};

document.addEventListener('DOMContentLoaded', () => {
  const bindCursorTargets = setupCursor();
  const bindTilts = setupTiltInteractions();

  setupSmoothScroll();
  splitHeroHeading();
  runIntroAnimations();
  setupEditorialStrip();
  setupHeroStage();
  setupContactStage();
  setupScrollAnimations();
  setupTagInteractions();
  setupPromptChips(bindCursorTargets);
  setupGenerator(bindCursorTargets, bindTilts);
  setupContactForm();
  setupWishlistAuth(bindCursorTargets);
  setupModal();
  runDevContractAssertions();

  bindCursorTargets(document.querySelectorAll('a, button, .tag, .elegant-input, textarea, .prompt-chip, .contact-method, .nav-link--ghost, .result-card__wish'));
  bindTilts(document.querySelectorAll('.point-card, .collection-card, .feature-card, .timeline-step, .studio-card, .footer-cta-card, .contact-form, .contact-stack-card, .contact-method'));

  window.addEventListener('load', () => ScrollTrigger.refresh());
});

function devContractWarn(message, detail) {
  if (!DEV_CONTRACT_ASSERTIONS) {
    return;
  }
  if (detail !== undefined) {
    console.warn(`[GiftAI contract] ${message}`, detail);
  } else {
    console.warn(`[GiftAI contract] ${message}`);
  }
}

function runDevContractAssertions() {
  if (!DEV_CONTRACT_ASSERTIONS) {
    return;
  }

  const hero = document.querySelector('.hero');
  if (hero?.querySelector('input, textarea, select, .prompt-chip, #generateBtn')) {
    devContractWarn('Hero must remain brand + CTA + visual only; recommender inputs belong in #recommender.');
  }

  const recommender = document.querySelector('#recommender');
  if (!recommender?.querySelector('#recipientName') || !recommender?.querySelector('#generateBtn')) {
    devContractWarn('Recommender section is missing the active recommendation input flow.');
  }

  const stage = document.querySelector('.hero-stage');
  if (stage) {
    const style = getComputedStyle(stage);
    const height = Math.round(stage.getBoundingClientRect().height);
    if (height === 830 || style.transform !== 'none') {
      devContractWarn('Hero stage drift detected; final authoritative CSS should use responsive sizing and no transform hack.', {
        height,
        transform: style.transform,
      });
    }
  }
}

function setupCursor() {
  const cursor = document.querySelector('.cursor');
  const cursorFollower = document.querySelector('.cursor-follower');
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer || !cursor || !cursorFollower) {
    return () => {};
  }

  const rootStyles = getComputedStyle(document.documentElement);
  const accentStrong = rootStyles.getPropertyValue('--accent-strong').trim() || '#ff9a61';
  const accentSecondary = rootStyles.getPropertyValue('--accent-secondary').trim() || '#70d6c1';

  const setCursorState = (isActive) => {
    gsap.to(cursorFollower, {
      scale: isActive ? 1.45 : 1,
      borderColor: isActive ? accentSecondary : 'rgba(247, 241, 232, 0.4)',
      duration: 0.25,
      overwrite: true,
    });

    gsap.to(cursor, {
      scale: isActive ? 0.6 : 1,
      backgroundColor: isActive ? accentSecondary : accentStrong,
      duration: 0.25,
      overwrite: true,
    });
  };

  document.addEventListener('mousemove', (event) => {
    gsap.to(cursor, { x: event.clientX, y: event.clientY, duration: 0, overwrite: true });
    gsap.to(cursorFollower, { x: event.clientX, y: event.clientY, duration: 0.12, overwrite: true });
  });

  return (targets) => {
    targets.forEach((target) => {
      if (!(target instanceof HTMLElement) || target.dataset.cursorBound === 'true') {
        return;
      }

      target.dataset.cursorBound = 'true';
      target.addEventListener('mouseenter', () => setCursorState(true));
      target.addEventListener('mouseleave', () => setCursorState(false));
      target.addEventListener('focus', () => setCursorState(true));
      target.addEventListener('blur', () => setCursorState(false));
    });
  };
}

function setupTiltInteractions() {
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer || reducedMotion) {
    return () => {};
  }

  return (targets) => {
    targets.forEach((target) => {
      if (!(target instanceof HTMLElement) || target.dataset.tiltBound === 'true') {
        return;
      }

      target.dataset.tiltBound = 'true';
      const media = target.querySelector('img, .card-img');
      target.style.setProperty('--glow-x', '50%');
      target.style.setProperty('--glow-y', '50%');

      target.addEventListener('pointermove', (event) => {
        const rect = target.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        const glowX = `${((event.clientX - rect.left) / rect.width) * 100}%`;
        const glowY = `${((event.clientY - rect.top) / rect.height) * 100}%`;

        target.style.setProperty('--glow-x', glowX);
        target.style.setProperty('--glow-y', glowY);
        target.classList.add('is-glow-active');

        gsap.to(target, {
          rotationY: x * 10,
          rotationX: -y * 10,
          transformPerspective: 1200,
          transformOrigin: 'center center',
          duration: 0.35,
          ease: 'power2.out',
          overwrite: true,
        });

        if (media) {
          gsap.to(media, {
            x: x * 12,
            y: y * 10,
            scale: 1.04,
            duration: 0.35,
            ease: 'power2.out',
            overwrite: true,
          });
        }
      });

      target.addEventListener('pointerleave', () => {
        target.style.setProperty('--glow-x', '50%');
        target.style.setProperty('--glow-y', '50%');
        target.classList.remove('is-glow-active');

        gsap.to(target, {
          rotationY: 0,
          rotationX: 0,
          duration: 0.55,
          ease: 'power3.out',
          overwrite: true,
        });

        if (media) {
          gsap.to(media, {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.55,
            ease: 'power3.out',
            overwrite: true,
          });
        }
      });
    });
  };
}

function splitHeroHeading() {
  const heading = document.getElementById('heroHeading');

  if (!heading) {
    return;
  }

  const text = heading.textContent.trim();
  heading.innerHTML = '';

  text.split(' ').forEach((word) => {
    const span = document.createElement('span');
    span.className = 'anim-word';
    span.textContent = `${word} `;
    heading.appendChild(span);
  });
}

function hideLoaderOverlay() {
  const loader = document.querySelector('.loader');

  if (!loader || loader.dataset.hidden === 'true') {
    return;
  }

  loader.dataset.hidden = 'true';
  gsap.killTweensOf(['.loader', '.loader-text .word', '.loader-progress']);
  gsap.set(loader, { clearProps: 'opacity,transform' });
  loader.style.display = 'none';
  loader.setAttribute('aria-hidden', 'true');
}

function runIntroAnimations() {
  const loaderFailsafeId = window.setTimeout(() => {
    hideLoaderOverlay();
  }, reducedMotion ? 900 : 4800);
  const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });

  timeline
    .to('.loader-text .word', {
      y: 0,
      opacity: 1,
      duration: reducedMotion ? 0.2 : 0.8,
      stagger: reducedMotion ? 0.02 : 0.18,
    })
    .fromTo(
      '.loader-progress',
      { scaleX: 0, transformOrigin: 'left center' },
      {
        scaleX: 1,
        duration: reducedMotion ? 0.2 : 1,
        ease: 'power2.inOut',
      },
      '-=0.35',
    )
    .to('.loader', {
      yPercent: -100,
      autoAlpha: 0,
      duration: reducedMotion ? 0.25 : 1.05,
      ease: 'power4.inOut',
      delay: reducedMotion ? 0 : 0.18,
    })
    .call(() => {
      window.clearTimeout(loaderFailsafeId);
      hideLoaderOverlay();
    })
    .from(
      '.navbar',
      {
        y: -36,
        opacity: 0,
        duration: reducedMotion ? 0.2 : 0.7,
      },
      '-=0.35',
    )
    .from(
      ['.eyebrow', '.hero-chip'],
      {
        y: 18,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.55,
        stagger: 0.08,
      },
      '-=0.15',
    )
    .from(
      '.anim-word',
      {
        y: 56,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.78,
        stagger: reducedMotion ? 0.02 : 0.1,
        ease: reducedMotion ? 'power1.out' : 'back.out(1.7)',
      },
      '-=0.05',
    )
    .from(
      '.hero-title--accent',
      {
        y: 26,
        opacity: 0,
        duration: reducedMotion ? 0.18 : 0.55,
      },
      '-=0.55',
    )
    .from(
      '.hero-stage',
      {
        scale: 0.96,
        opacity: 0,
        rotateX: 4,
        duration: reducedMotion ? 0.2 : 1.1,
      },
      '-=0.7',
    )
    .fromTo(
      ['#heroAutoFade', '.hero-cta-group'],
      { y: 28, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: reducedMotion ? 0.18 : 0.7,
        stagger: 0.14,
      },
      '-=0.45',
    )
    .from(
      ['.stage-badge', '.floating-card', '.scene'],
      {
        y: 22,
        opacity: 0,
        duration: reducedMotion ? 0.16 : 0.55,
        stagger: 0.08,
      },
      '-=0.8',
    )
    .call(startTypewriter);
}

function startTypewriter() {
  const phrases = ['beautifully', 'with presence', 'for milestone moments', 'without the guesswork'];
  const target = document.getElementById('typewriterText');

  if (!target) {
    return;
  }

  let isDeleting = false;
  let loopIndex = 0;
  let currentText = '';

  function tick() {
    const phrase = phrases[loopIndex % phrases.length];

    currentText = isDeleting
      ? phrase.slice(0, currentText.length - 1)
      : phrase.slice(0, currentText.length + 1);

    target.textContent = currentText;

    let delay = isDeleting ? 45 : 80;

    if (!isDeleting && currentText === phrase) {
      delay = 1800;
      isDeleting = true;
    } else if (isDeleting && currentText === '') {
      isDeleting = false;
      loopIndex += 1;
      delay = 320;
    }

    window.setTimeout(tick, reducedMotion ? 120 : delay);
  }

  tick();
}

function setupEditorialStrip() {
  const track = document.querySelector('.editorial-strip__track');

  if (!track || reducedMotion) {
    return;
  }

  gsap.to(track, {
    xPercent: -50,
    duration: 24,
    ease: 'none',
    repeat: -1,
  });
}

function setupSmoothScroll() {
  const navbar = document.querySelector('.navbar');
  const links = document.querySelectorAll('a[href^="#"]:not([href="#"])');

  if (!links.length) {
    return;
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const href = link.getAttribute('href');

      if (!href) {
        return;
      }

      const target = document.querySelector(href);

      if (!target) {
        return;
      }

      event.preventDefault();

      const navOffset = navbar ? navbar.getBoundingClientRect().height + 24 : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - navOffset;

      window.scrollTo({
        top: Math.max(0, top),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });

      if (window.location.hash !== href) {
        window.history.replaceState(null, '', href);
      }
    });
  });
}

function setupHeroStage() {
  const stage = document.querySelector('.hero-stage');
  const stageMotion = document.querySelector('.hero-stage__motion');
  const spotlight = document.querySelector('.spotlight');

  if (!stage || !stageMotion) {
    setupCube();
    return;
  }

  if (!reducedMotion) {
    gsap.to('.stage-rays', {
      rotate: 360,
      duration: 36,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.orbit--outer', {
      rotate: 360,
      duration: 24,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.orbit--inner', {
      rotate: -360,
      duration: 18,
      ease: 'none',
      repeat: -1,
    });

    // Keep orbit/cube motion only; avoid card drift so hero cards stay inside the fixed 2x2 layout.

    gsap.utils.toArray('.insight-panel__bars span').forEach((bar, index) => {
      gsap.to(bar, {
        scaleY: 0.45 + ((index % 3) + 1) * 0.18,
        transformOrigin: 'bottom center',
        duration: 0.9 + index * 0.12,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });
  }

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const interactiveStage = finePointer && !reducedMotion && window.matchMedia('(min-width: 1025px)').matches;

  if (interactiveStage) {
    gsap.set(stageMotion, {
      transformPerspective: 1600,
      transformStyle: 'preserve-3d',
      force3D: true,
    });

    let stageRect = stage.getBoundingClientRect();
    const updateRect = () => {
      stageRect = stage.getBoundingClientRect();
    };
    const spotlightXTo = spotlight ? gsap.quickTo(spotlight, 'x', { duration: 0.5, ease: 'power2.out' }) : null;
    const spotlightYTo = spotlight ? gsap.quickTo(spotlight, 'y', { duration: 0.5, ease: 'power2.out' }) : null;

    stage.addEventListener('pointerenter', updateRect, { passive: true });
    window.addEventListener('resize', updateRect, { passive: true });

    stage.addEventListener('pointermove', (event) => {
      const x = (event.clientX - stageRect.left) / stageRect.width - 0.5;
      const y = (event.clientY - stageRect.top) / stageRect.height - 0.5;

      spotlightXTo?.(x * 8);
      spotlightYTo?.(y * 7);
    }, { passive: true });

    stage.addEventListener('pointerleave', () => {
      spotlightXTo?.(0);
      spotlightYTo?.(0);
    });
  }

  setupCube(stage);
}

function setupPromptChips(bindCursorTargets) {
  const chips = document.querySelectorAll('.prompt-chip');
  const input = document.getElementById('recipientName');

  if (!chips.length || !input) {
    return;
  }

  bindCursorTargets(chips);

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt') || '';
      input.value = prompt;
      input.focus();

      chips.forEach((item) => item.classList.remove('is-active'));
      chip.classList.add('is-active');

      gsap.fromTo(
        input,
        { boxShadow: '0 0 0 0 rgba(255, 154, 97, 0.0)' },
        {
          boxShadow: '0 0 0 10px rgba(255, 154, 97, 0.14)',
          duration: 0.4,
          yoyo: true,
          repeat: 1,
          ease: 'power1.inOut',
        },
      );
    });
  });

  input.addEventListener('input', () => {
    chips.forEach((chip) => chip.classList.remove('is-active'));
  });
}

function setupContactStage() {
  const stage = document.querySelector('.contact-stage');
  const stageGrid = stage?.querySelector('.contact-stage__grid');
  const flow = stage?.querySelector('.contact-flow');
  const hub = stage?.querySelector('.contact-flow__hub');
  const ambientWarm = stage?.querySelector('.contact-ambient--warm');
  const ambientCool = stage?.querySelector('.contact-ambient--cool');

  if (!stage || reducedMotion) {
    return;
  }

  gsap.utils.toArray('.contact-stack-card').forEach((card, index) => {
    gsap.to(card, {
      yPercent: index === 1 ? -3 : 4,
      xPercent: index === 0 ? -1.2 : index === 1 ? 1.2 : 0.8,
      rotateZ: index === 0 ? -1.2 : index === 1 ? 1.1 : -0.8,
      duration: 4.5 + index * 0.45,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  });

  gsap.to(ambientWarm, {
    y: -18,
    x: 20,
    duration: 5.4,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });

  gsap.to(ambientCool, {
    y: 16,
    x: -18,
    duration: 6,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  });

  if (flow && hub) {
    if (stageGrid) {
      gsap.to(stageGrid, {
        x: -14,
        y: -10,
        duration: 18,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    }

    gsap.to('.contact-flow__trace--one', {
      strokeDashoffset: -160,
      duration: 7.5,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__trace--two', {
      strokeDashoffset: -130,
      duration: 6.8,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__trace--three', {
      strokeDashoffset: -148,
      duration: 8.2,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub-ring--outer', {
      rotate: 360,
      svgOrigin: '342 248',
      duration: 20,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub-ring--inner', {
      rotate: -360,
      svgOrigin: '342 248',
      duration: 14,
      ease: 'none',
      repeat: -1,
    });

    gsap.to('.contact-flow__hub', {
      y: -6,
      rotate: 8,
      svgOrigin: '342 248',
      duration: 6.8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__halo--outer', {
      scale: 1.06,
      opacity: 0.52,
      svgOrigin: '342 248',
      duration: 4.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });

    gsap.to('.contact-flow__halo--inner', {
      scale: 1.1,
      opacity: 0.38,
      svgOrigin: '342 248',
      duration: 5.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-prism', {
      rotate: -8,
      y: -4,
      svgOrigin: '342 248',
      duration: 5.2,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-facet', {
      rotate: 10,
      y: 2,
      svgOrigin: '342 248',
      duration: 4.6,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.to('.contact-flow__hub-core', {
      scale: 1.2,
      opacity: 0.92,
      svgOrigin: '342 248',
      duration: 2.4,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });

    gsap.utils.toArray('.contact-flow__spark').forEach((spark, index) => {
      gsap.to(spark, {
        opacity: 0.2 + index * 0.08,
        duration: 1.9 + index * 0.4,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    });

    gsap.utils.toArray('.contact-flow__node').forEach((node, index) => {
      gsap.to(node, {
        scale: index === 1 ? 1.28 : 1.18,
        duration: 2.3 + index * 0.35,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    });

    const animatePulseAlongPath = (pulseSelector, pathSelector, duration, delay = 0) => {
      const pulse = stage.querySelector(pulseSelector);
      const path = stage.querySelector(pathSelector);

      if (!pulse || !path) {
        return;
      }

      const length = path.getTotalLength();
      const state = { progress: 0 };

      const render = () => {
        const point = path.getPointAtLength(length * state.progress);
        let opacity = 1;

        if (state.progress < 0.12) {
          opacity = state.progress / 0.12;
        } else if (state.progress > 0.82) {
          opacity = Math.max(0, 1 - (state.progress - 0.82) / 0.18);
        }

        gsap.set(pulse, {
          attr: { cx: point.x, cy: point.y },
          opacity,
        });
      };

      render();

      gsap.to(state, {
        progress: 1,
        duration,
        delay,
        ease: 'none',
        repeat: -1,
        onUpdate: render,
      });
    };

    animatePulseAlongPath('.contact-flow__pulse--one', '.contact-flow__path--one', 5.6, 0.2);
    animatePulseAlongPath('.contact-flow__pulse--two', '.contact-flow__path--two', 4.8, 0.8);
    animatePulseAlongPath('.contact-flow__pulse--three', '.contact-flow__path--three', 5.2, 0.4);
  }

  const finePointer = window.matchMedia('(pointer: fine)').matches;

  if (!finePointer) {
    return;
  }

  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    gsap.to(flow, {
      x: x * 18,
      y: y * 14,
      duration: 0.7,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.to(ambientWarm, {
      x: x * 28,
      y: y * 18,
      duration: 0.9,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.to(ambientCool, {
      x: -x * 24,
      y: -y * 16,
      duration: 0.9,
      ease: 'power3.out',
      overwrite: true,
    });

    gsap.utils.toArray('.contact-stack-card').forEach((card, index) => {
      const direction = index === 1 ? -1 : index === 2 ? 0.45 : 1;
      gsap.to(card, {
        x: x * (6 + index * 1.8) * direction,
        y: y * (4 + index * 1.4),
        duration: 0.75,
        ease: 'power3.out',
        overwrite: true,
      });
    });
  });

  stage.addEventListener('pointerleave', () => {
    gsap.to(flow, {
      x: 0,
      y: 0,
      duration: 0.85,
      ease: 'power3.out',
    });

    gsap.to([ambientWarm, ambientCool], {
      x: 0,
      y: 0,
      duration: 0.95,
      ease: 'power3.out',
    });

    gsap.utils.toArray('.contact-stack-card').forEach((card) => {
      gsap.to(card, {
        x: 0,
        y: 0,
        duration: 0.85,
        ease: 'power3.out',
      });
    });
  });
}

async function copyFeedbackDraft(text) {
  try {
    if (!navigator.clipboard?.writeText) {
      return false;
    }

    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    return false;
  }
}

function setupContactForm() {
  const form = document.getElementById('contactForm');
  const nameInput = document.getElementById('contactName');
  const emailInput = document.getElementById('contactEmail');
  const subjectInput = document.getElementById('contactSubject');
  const messageInput = document.getElementById('contactMessage');
  const status = document.getElementById('contactStatus');
  const actions = document.getElementById('contactActions');
  const gmailDraftLink = document.getElementById('contactGmailDraft');
  const mailAppLink = document.getElementById('contactMailApp');
  const copyMessageButton = document.getElementById('contactCopyMessage');

  if (!form || !nameInput || !emailInput || !subjectInput || !messageInput || !status || !actions || !gmailDraftLink || !mailAppLink || !copyMessageButton) {
    return;
  }

  let latestDraftText = '';
  let submitSuccessShown = false;

  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };

  copyMessageButton.addEventListener('click', async () => {
    if (!latestDraftText) {
      setStatus('Write a quick message first, then we can prepare it for copy or email.', 'error');
      messageInput.focus();
      return;
    }

    const copied = await copyFeedbackDraft(latestDraftText);
    setStatus(copied ? 'Your prepared message is copied. You can paste it into any mail app.' : 'Clipboard access is blocked here. Use the draft links instead.', copied ? 'success' : 'error');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = nameInput.value.trim() || 'GiftAI visitor';
    const email = emailInput.value.trim();
    const subject = subjectInput.value.trim() || 'GiftAI Atelier inquiry';
    const message = messageInput.value.trim() || 'Hello, I would like to share feedback or discuss a custom gifting idea.';

    if (!messageInput.value.trim()) {
      setStatus('Add a short message first so we know what you want to improve.', 'error');
      messageInput.focus();
      return;
    }

    const body = [
      `Name: ${name}`,
      `Email: ${email || 'Not provided'}`,
      `Subject: ${subject}`,
      '',
      message,
    ].join('\n');

    latestDraftText = body;
    actions.hidden = true;
    gmailDraftLink.href = '#';
    mailAppLink.href = '#';

    setStatus('Feedback submitted successfully.', 'success');
    if (!submitSuccessShown) {
      window.alert('Feedback submitted successfully.');
      submitSuccessShown = true;
    }
    form.reset();
  });
}

function setupScrollAnimations() {
  if (reducedMotion) {
    return;
  }

  gsap.to('.orb-1', {
    y: 80,
    x: -34,
    scrollTrigger: {
      trigger: '.hero-stage',
      start: 'top top',
      end: 'bottom top',
      scrub: 1,
    },
  });

  gsap.to('.orb-2', {
    y: -64,
    x: 38,
    scrollTrigger: {
      trigger: '.hero-stage',
      start: 'top top',
      end: 'bottom top',
      scrub: 1.2,
    },
  });

  gsap.from('.glass-panel', {
    y: 54,
    opacity: 0,
    duration: 0.9,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.glass-panel',
      start: 'top 82%',
    },
  });

  gsap.from('.point-card', {
    y: 34,
    opacity: 0,
    duration: 0.7,
    stagger: 0.12,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.panel-points',
      start: 'top 84%',
    },
  });

  gsap.from('.studio-card > *', {
    y: 24,
    opacity: 0,
    duration: 0.62,
    stagger: 0.08,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.studio-card',
      start: 'top 86%',
    },
  });

  gsap.utils.toArray('.section-header').forEach((header) => {
    const children = header.querySelectorAll('.section-kicker, .section-title');
    gsap.from(children, {
      y: 32,
      opacity: 0,
      duration: 0.75,
      stagger: 0.1,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: header,
        start: 'top 85%',
      },
    });
  });

  gsap.utils.toArray('.collection-card').forEach((card, index) => {
    gsap.from(card, {
      y: 42,
      opacity: 0,
      rotateY: index % 2 === 0 ? 8 : -8,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: card,
        start: 'top 84%',
      },
    });

    const image = card.querySelector('.collection-card__image');
    if (image) {
      gsap.to(image, {
        yPercent: -8,
        ease: 'none',
        scrollTrigger: {
          trigger: card,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.2,
        },
      });
    }
  });

  gsap.from('.feature-card', {
    y: 46,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.features-grid',
      start: 'top 84%',
    },
  });

  gsap.from('.timeline-step', {
    y: 48,
    opacity: 0,
    duration: 0.76,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.timeline',
      start: 'top 84%',
    },
  });

  gsap.from('.contact-grid > *', {
    y: 42,
    opacity: 0,
    duration: 0.78,
    stagger: 0.14,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.contact-grid',
      start: 'top 84%',
    },
  });

  gsap.from('.footer-shell', {
    y: 36,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '.app-footer',
      start: 'top 88%',
    },
  });
}

function setupTagInteractions() {
  document.querySelectorAll('.tag').forEach((tag) => {
    tag.addEventListener('click', () => {
      const group = tag.dataset.tagGroup || '';
      if (group) {
        document.querySelectorAll(`.tag[data-tag-group="${group}"]`).forEach((peer) => {
          if (peer !== tag) {
            peer.classList.remove('selected');
          }
        });
      }
      tag.classList.toggle('selected');
    });
  });
}

function setupGenerator(bindCursorTargets, bindTilts) {
  const generateButton = document.getElementById('generateBtn');
  const buttonText = document.querySelector('.btn-text');
  const resultsArea = document.getElementById('resultsArea');
  const profileInput = document.getElementById('recipientName');

  if (!generateButton || !buttonText || !resultsArea || !profileInput) {
    return;
  }

  profileInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      generateButton.click();
    }
  });

  generateButton.addEventListener('click', async () => {
    const profile = profileInput.value.trim() || 'someone thoughtful';
    const selectedTags = Array.from(document.querySelectorAll('.tag.selected')).map((tag) => tag.textContent.trim());
    const activeChip = document.querySelector('.prompt-chip.is-active');
    const context = buildRecommendationContext({
      profile,
      selectedTags,
      activeChipLabel: activeChip?.textContent.trim() || '',
      activeChipPrompt: activeChip?.getAttribute('data-prompt') || '',
    });
    const contextLabel = getContextLabel(context);
    const rankedProducts = rankCatalogProducts(context);
    const clarificationItem = buildClarifyingPromptItem(context, rankedProducts);
    const candidateProducts = clarificationItem ? [] : selectCatalogProducts(rankedProducts, 14, context);
    const fallbackItems = clarificationItem ? [clarificationItem] : getFallbackCatalogProducts(context, 6);
    const shouldScroll = resultsArea.classList.contains('hidden');

    buttonText.textContent = 'Curating your shortlist...';
    generateButton.disabled = true;
    generateButton.style.opacity = '0.82';

    renderLoadingCards(resultsArea, contextLabel);

    if (shouldScroll) {
      resultsArea.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }

    try {
      if (clarificationItem) {
        renderResults([clarificationItem], resultsArea, contextLabel, bindCursorTargets, bindTilts, context);
        return;
      }

      const items = await requestGiftIdeas(context, candidateProducts);
      renderResults(items, resultsArea, contextLabel, bindCursorTargets, bindTilts, context);
    } catch (error) {
      console.error('[CRITICAL] Backend rejected → using fallback');
      console.warn('Falling back to mock data:', error);
      renderResults(fallbackItems.length ? fallbackItems : getFallbackCatalogProducts(context, 6), resultsArea, contextLabel, bindCursorTargets, bindTilts, context);
    } finally {
      buttonText.textContent = 'Generate Gift Ideas';
      generateButton.disabled = false;
      generateButton.style.opacity = '1';
    }
  });
}

function renderLoadingCards(resultsArea, contextLabel) {
  resultsArea.classList.remove('hidden');
  resultsArea.innerHTML = Array.from({ length: 3 }, () => {
    return `
      <article class="result-card result-card--loading">
        <div class="skeleton skeleton-media"></div>
        <div class="result-card__body">
          <span class="result-card__eyebrow">${escapeHtml(contextLabel)}</span>
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line skeleton-line--short"></div>
        </div>
        <div class="result-card__footer">
          <div class="skeleton skeleton-price"></div>
          <div class="skeleton skeleton-cta"></div>
        </div>
      </article>
    `;
  }).join('');
}

function buildRecommendationContext({ profile, selectedTags, activeChipLabel, activeChipPrompt }) {
  const normalizedTags = selectedTags.map((tag) => normalizeUiTag(tag));
  const selectedOccasionIndex = normalizedTags.findIndex((tag) => KNOWN_OCCASIONS.has(tag));
  const selectedOccasion = selectedOccasionIndex >= 0 ? normalizedTags[selectedOccasionIndex] : '';
  const selectedOccasionLabel = selectedOccasionIndex >= 0 ? selectedTags[selectedOccasionIndex] : '';
  const profileSignals = collectInputSignals(profile);
  const chipSignals = mergeSignalSets(
    collectInputSignals(activeChipLabel),
    collectInputSignals(activeChipPrompt),
  );
  const combinedSignals = mergeSignalSets(profileSignals, chipSignals);
  const fullIntentText = [profile, activeChipLabel, activeChipPrompt].filter(Boolean).join(' ');
  const tunedSignals = applyPhaseBPhraseExpansions(fullIntentText, combinedSignals);
  const priceSensitivity = inferPriceSensitivity(profile, normalizedTags);
  const recipientType = pickPrimaryRecipientTag(tunedSignals.recipientTags);
  const occasion = selectedOccasion || collectMappedTags(profile, OCCASION_SIGNAL_MAP)[0] || '';
  const avoidTags = unique([
    ...tunedSignals.badFit.groups,
    ...tunedSignals.badFit.styles,
    ...tunedSignals.badFit.keywords,
  ]);
  const confidence = computeIntentConfidence({
    rawProfile: profile,
    recipientTags: tunedSignals.recipientTags,
    interestTags: tunedSignals.interestTags,
    styleTags: tunedSignals.styleTags,
    categoryTags: tunedSignals.categoryTags,
    occasion,
    avoidTags,
  });

  const context = {
    rawProfile: profile,
    activeChipLabel,
    activeChipPrompt,
    recipientType,
    occasion,
    selectedOccasion,
    selectedOccasionLabel,
    priceSensitivity,
    luxurySelected: normalizedTags.includes('luxury'),
    inferredOccasions: collectMappedTags(profile, OCCASION_SIGNAL_MAP),
    profileSignals,
    chipSignals,
    recipientTags: tunedSignals.recipientTags,
    interestTags: tunedSignals.interestTags,
    styleTags: tunedSignals.styleTags,
    categoryTags: tunedSignals.categoryTags,
    keywordTags: tunedSignals.keywordTags,
    intentTags: tunedSignals.semanticTags,
    preferredGroups: tunedSignals.preferredGroups,
    badFit: tunedSignals.badFit,
    avoidTags,
    confidence,
    hasClearRecipientIntent: tunedSignals.hasClearRecipientIntent,
    hasStrongInterestSignal: tunedSignals.interestTags.length > 0
      || tunedSignals.categoryTags.length > 0
      || tunedSignals.keywordTags.length > 0,
    tokens: unique([
      ...tokenizeText(profile),
      ...tokenizeText(activeChipLabel),
      ...tokenizeText(activeChipPrompt),
    ]),
    normalizedIntent: null,
  };

  context.normalizedIntent = buildNormalizedIntent(context);
  return context;
}

function getContextLabel(context) {
  if (context.selectedOccasionLabel) {
    return context.selectedOccasionLabel;
  }

  if (context.activeChipLabel) {
    return context.activeChipLabel;
  }

  return context.luxurySelected ? 'Luxury' : 'Tailored pick';
}

async function requestGiftIdeas(context, candidateProducts) {
  const apiBase = getApiBase();
  const url = `${apiBase}/api/gemini/generate`;
  const payload = buildRecommendationRequestPayload(context, candidateProducts);

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    20000,
  );

  const envelope = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(envelope?.error || envelope?.detail || 'Gemini proxy request failed');
  }

  if (!Array.isArray(envelope?.items) || !envelope.items.length) {
    throw new Error('Empty recommendation response');
  }

  const parsed = { recommendations: envelope.items };
  const validated = validateModelRecommendations(parsed, candidateProducts, context);
  if (validated && validated.length >= 4) {
    return validated;
  }

  throw new Error('Model response was incomplete or invalid');
}

async function fetchWithTimeout(resource, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(id);
  return response;
}

function buildRecommendationRequestPayload(context, candidateProducts) {
  const catalogPreview = candidateProducts.map((product) => ({
    id: product.id,
    type: product.type,
    title: product.title,
    brand: product.brand,
    category: product.category,
    description: product.description,
    image: product.image,
    imageTags: product.imageTags,
    searchTerm: product.searchTerm,
    imageSearchQuery: product.imageSearchQuery,
    marketplaceLinks: product.type === 'verified' ? (product.marketplaceLinks || {}) : {},
    marketplacePrices: product.type === 'verified' ? (product.marketplacePrices || {}) : {},
    validationStatus: product.validationStatus,
    tags: product.tags,
    recipientTags: product.recipientTags,
    interestTags: product.interestTags,
    occasionTags: product.occasionTags,
    styleTags: product.styleTags,
  }));

  return {
    context: {
      rawProfile: context.rawProfile,
      recipientType: context.recipientType || 'unknown',
      activeChipLabel: context.activeChipLabel || '',
      selectedOccasionLabel: context.selectedOccasionLabel || '',
      luxurySelected: Boolean(context.luxurySelected),
      priceSensitivity: context.priceSensitivity || 'balanced',
      confidence: Number.isFinite(Number(context.confidence)) ? Number(context.confidence) : 0.5,
      normalizedIntent: context.normalizedIntent || {},
      recipientTags: context.recipientTags || [],
      interestTags: context.interestTags || [],
      styleTags: context.styleTags || [],
      categoryTags: context.categoryTags || [],
      avoidTags: context.avoidTags || [],
      intentTags: context.intentTags || [],
    },
    candidates: catalogPreview,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };
}

function hasBackendTypeDecision(selection) {
  return selection
    && typeof selection === 'object'
    && ['verified', 'concept', 'clarify'].includes(selection.type);
}

function validateModelRecommendations(parsed, candidateProducts, context) {
  const selections = Array.isArray(parsed) ? parsed : parsed?.recommendations || parsed?.items;

  if (!Array.isArray(selections)) {
    throw new Error('Model response did not include a recommendations array');
  }

  const productMap = new Map(candidateProducts.map((product) => [product.id, product]));
  const uniqueSelections = [];
  const usedIds = new Set();

  selections.forEach((selection) => {
    const selObj = typeof selection === 'object' && selection ? selection : null;
    const id = typeof selection === 'string' ? selection : selection?.id;

    if (typeof id !== 'string' || !id.trim() || usedIds.has(id)) {
      return;
    }

    const reason = sanitizeText(selObj?.reason, '', 120);
    const imageSearchQuery = sanitizeText(selObj?.imageSearchQuery || selObj?.imageQuery || '', '', 200);
    const price = Number(selObj?.price);

    if (hasBackendTypeDecision(selObj)) {
      const typed = buildRenderableGiftItem({
        ...selObj,
        reason: reason || selObj.reason,
        rankPrice: null,
      }, { reason });

      if (!typed) {
        return;
      }

      usedIds.add(typed.id);
      uniqueSelections.push(typed);
      return;
    }

    if (productMap.has(id)) {
      const base = { ...productMap.get(id) };
      if (imageSearchQuery) {
        base.imageSearchQuery = imageSearchQuery;
      }

      const product = buildRenderableGiftItem(base, { reason });

      if (!product) {
        return;
      }

      usedIds.add(product.id);
      uniqueSelections.push(product);
      return;
    }

    if (selObj?.title) {
      const permitImage = sanitizeImage(selObj?.image) || '/minimal_desk.png';
      const invented = buildRenderableGiftItem({
        id: sanitizeText(id, normalizeUiTag(selObj.title) || 'concept', 80),
        type: 'concept',
        title: sanitizeText(selObj.title, '', 120),
        description: sanitizeText(selObj.reason || selObj.description, 'Curated gift direction.', 220),
        category: sanitizeText(selObj.category, 'Gift idea', 80),
        image: permitImage,
        rankPrice: null,
        imageSearchQuery: imageSearchQuery || sanitizeText(selObj.title, '', 120),
        recipientTags: Array.isArray(selObj.recipientTags) ? selObj.recipientTags : [],
        interestTags: Array.isArray(selObj.interestTags) ? selObj.interestTags : [],
        styleTags: Array.isArray(selObj.styleTags) ? selObj.styleTags : [],
        occasionTags: Array.isArray(selObj.occasionTags) ? selObj.occasionTags : [],
        tags: Array.isArray(selObj.tags) ? selObj.tags : [],
      }, { reason });

      if (!invented) {
        return;
      }

      usedIds.add(id);
      uniqueSelections.push(invented);
    }
  });

  if (uniqueSelections.length < 4) {
    throw new Error('Model response was incomplete or invalid');
  }

  return uniqueSelections.slice(0, 6);
}

function rankCatalogProducts(context) {
  const candidates = applyRecipientHardFilter(GIFT_ENGINE_CATALOG, context);

  return candidates
    .map((product) => ({
      product,
      scoreBreakdown: scoreProduct(product, context),
      recipientRelevance: getRecipientRelevanceScore(product, context),
      recipientRelevant: isRecipientRelevantProduct(product, context),
    }))
    .sort((left, right) => {
      if (right.scoreBreakdown.totalScore !== left.scoreBreakdown.totalScore) {
        return right.scoreBreakdown.totalScore - left.scoreBreakdown.totalScore;
      }

      if (right.recipientRelevance !== left.recipientRelevance) {
        return right.recipientRelevance - left.recipientRelevance;
      }

      return Math.abs(getTargetPrice(context) - getComparablePrice(left.product)) - Math.abs(getTargetPrice(context) - getComparablePrice(right.product));
    });
}

function applyRecipientHardFilter(products, context) {
  if (!context.hasClearRecipientIntent && !context.hasStrongInterestSignal) {
    return products;
  }

  const passesClusterGate = (product) => {
    const cluster = computeIntentClusterAlignment(product, context);
    const rel = getRecipientRelevanceScore(product, context);
    return cluster >= 30 || rel >= 24;
  };

  const relevantProducts = products.filter((product) => (
    isRecipientRelevantProduct(product, context) || passesClusterGate(product)
  ));
  if (relevantProducts.length >= 4) {
    return relevantProducts;
  }

  const mediumFitProducts = products.filter((product) => (
    getRecipientRelevanceScore(product, context) >= 20
    || computeIntentClusterAlignment(product, context) >= 26
  ));
  return mediumFitProducts.length >= 4 ? mediumFitProducts : products;
}

function selectCatalogProducts(entries, limit, context) {
  const selected = [];
  const selectedIds = new Set();
  const recipientFocusedEntries = (context.hasClearRecipientIntent || context.hasStrongInterestSignal)
    ? entries.filter((entry) => entry.recipientRelevant)
    : [];
  const recipientQuota = (context.hasClearRecipientIntent || context.hasStrongInterestSignal)
    ? Math.min(recipientFocusedEntries.length, Math.max(4, Math.ceil(limit * 0.84)))
    : 0;

  fillCatalogSelections(selected, selectedIds, recipientFocusedEntries, recipientQuota, context);
  fillCatalogSelections(selected, selectedIds, entries, limit, context);

  return selected.map((entry) => entry.product);
}

function fillCatalogSelections(selected, selectedIds, pool, targetSize, context) {
  while (selected.length < targetSize) {
    const nextEntry = pool
      .filter((entry) => !selectedIds.has(entry.product.id))
      .map((entry) => {
        const diversityAdjustment = computeDiversityAdjustment(entry.product, selected, context);

        const verifiedRelevantBoost = (entry.recipientRelevant && entry.product.type === 'verified') ? 26 : 0;
        const conceptInterestBoost = (entry.product.type === 'concept' && context.hasStrongInterestSignal && entry.recipientRelevant) ? 16 : 0;

        return {
          ...entry,
          diversityAdjustment,
          adjustedScore: entry.scoreBreakdown.totalScore + diversityAdjustment + verifiedRelevantBoost + conceptInterestBoost,
        };
      })
      .sort((left, right) => {
        if (right.adjustedScore !== left.adjustedScore) {
          return right.adjustedScore - left.adjustedScore;
        }

        if (right.recipientRelevance !== left.recipientRelevance) {
          return right.recipientRelevance - left.recipientRelevance;
        }

        return Math.abs(getTargetPrice(context) - getComparablePrice(left.product)) - Math.abs(getTargetPrice(context) - getComparablePrice(right.product));
      })[0];

    if (!nextEntry) {
      return;
    }

    selected.push({
      ...nextEntry,
      scoreBreakdown: {
        ...nextEntry.scoreBreakdown,
        diversityAdjustment: nextEntry.diversityAdjustment,
        totalScore: nextEntry.adjustedScore,
      },
    });
    selectedIds.add(nextEntry.product.id);
  }
}

function computeDiversityAdjustment(product, selectedEntries, context) {
  if (!selectedEntries.length) {
    return 0;
  }

  const productGroups = getProductGroupTags(product);
  const interestMatches = countMatches(product.interestTags, context.interestTags);
  const seenCategories = new Set(selectedEntries.map((entry) => entry.product.category));
  const seenBrands = new Set(selectedEntries.map((entry) => entry.product.brand));
  const seenGroups = new Set(selectedEntries.flatMap((entry) => getProductGroupTags(entry.product)));
  const overlappingGroups = countMatches(productGroups, [...seenGroups]);
  const newPreferredGroups = countMatches(
    productGroups.filter((group) => !seenGroups.has(group)),
    context.preferredGroups,
  );
  let adjustment = 0;

  if (seenCategories.has(product.category)) {
    adjustment -= 16;
  } else {
    adjustment += 4;
  }

  adjustment -= overlappingGroups * 12;
  adjustment += newPreferredGroups * 7;

  if (context.interestTags.length) {
    adjustment += interestMatches * 10;

    if (interestMatches === 0 && newPreferredGroups === 0) {
      adjustment -= 18;
    }
  }

  if (seenBrands.has(product.brand)) {
    adjustment -= 5;
  }

  if (selectedEntries.some((entry) => normalizeSearchText(entry.product.title) === normalizeSearchText(product.title))) {
    adjustment -= 24;
  }

  return adjustment;
}

function isRecipientRelevantProduct(product, context) {
  if (!context.hasClearRecipientIntent && !context.hasStrongInterestSignal) {
    return false;
  }

  return getRecipientRelevanceScore(product, context) >= (context.hasStrongInterestSignal ? 22 : 28);
}

function getRecipientRelevanceScore(product, context) {
  const productGroups = getProductGroupTags(product);
  const productText = getProductSearchText(product);
  const directRecipientMatches = countMatches(product.recipientTags, context.recipientTags);
  const interestMatches = countMatches(product.interestTags, context.interestTags);
  const preferredGroupMatches = countMatches(productGroups, context.preferredGroups);
  const styleMatches = countMatches(product.styleTags, context.styleTags);
  const categoryMatches = countCategoryMatches(product, context.categoryTags);
  const keywordMatches = scoreKeywordMatches(productText, context.keywordTags, 4, 2, 12);
  const discouragedGroupHits = countMatches(productGroups, context.badFit.groups);
  const discouragedStyleHits = countMatches(product.styleTags, context.badFit.styles);
  let score = (directRecipientMatches * 28)
    + (interestMatches * 22)
    + (preferredGroupMatches * 16)
    + (styleMatches * 7)
    + (categoryMatches * 9)
    + keywordMatches
    - (discouragedGroupHits * 26)
    - (discouragedStyleHits * 14);

  if (context.interestTags.length && interestMatches === 0 && preferredGroupMatches === 0 && categoryMatches === 0) {
    score -= 22;
  }

  score += computeIntentClusterAlignment(product, context) * 0.12;

  return score;
}

function scoreProduct(product, context) {
  const productText = getProductSearchText(product);
  const productGroups = getProductGroupTags(product);
  const comparablePrice = getComparablePrice(product);
  const profileRecipientMatches = countMatches(product.recipientTags, context.profileSignals.recipientTags);
  const chipRecipientMatches = countMatches(product.recipientTags, context.chipSignals.recipientTags);
  const profileInterestMatches = countMatches(product.interestTags, context.profileSignals.interestTags);
  const chipInterestMatches = countMatches(product.interestTags, context.chipSignals.interestTags);
  const totalInterestMatches = countMatches(product.interestTags, context.interestTags);
  const preferredGroupMatches = countMatches(productGroups, context.preferredGroups);
  const profileStyleMatches = countMatches(product.styleTags, context.profileSignals.styleTags);
  const chipStyleMatches = countMatches(product.styleTags, context.chipSignals.styleTags);
  const profileCategoryMatches = countCategoryMatches(product, context.profileSignals.categoryTags);
  const chipCategoryMatches = countCategoryMatches(product, context.chipSignals.categoryTags);
  const keywordMatchScore = scoreKeywordMatches(productText, context.keywordTags, 5, 2, 18);
  const tokenMatchScore = scoreTokenMatches(productText, context.tokens);
  const discouragedGroupHits = countMatches(productGroups, context.badFit.groups);
  const discouragedStyleHits = countMatches(product.styleTags, context.badFit.styles);
  const discouragedKeywordHits = scoreKeywordMatches(productText, context.badFit.keywords, 2, 1, 8);
  const hasRecipientAffinity = (profileRecipientMatches + chipRecipientMatches) > 0;
  const hasInterestAffinity = totalInterestMatches > 0 || preferredGroupMatches > 0 || (profileCategoryMatches + chipCategoryMatches) > 0;

  const recipientOnlyScore = (profileRecipientMatches * 52)
    + (chipRecipientMatches * 46);

  const interestScore = (profileInterestMatches * 32)
    + (chipInterestMatches * 28)
    + (preferredGroupMatches * 22)
    + ((profileCategoryMatches + chipCategoryMatches) * 9);

  const styleToneScore = (profileStyleMatches * 9)
    + (chipStyleMatches * 8)
    + (keywordMatchScore * 0.85)
    + (tokenMatchScore * 0.65);

  const recipientScore = recipientOnlyScore;
  const keywordScore = interestScore + styleToneScore;

  let occasionScore = scoreOccasionRefinement(product, context, productGroups) * 0.78;
  let luxuryScore = 0;
  let badFitPenalty = 0;

  if (context.luxurySelected) {
    luxuryScore += isLuxuryProduct(product) && hasInterestAffinity ? 5 : -5;
  } else {
    luxuryScore += comparablePrice >= 1500 && comparablePrice <= 18000 ? 2 : 0;

    if (isLuxuryProduct(product) && !hasInterestAffinity) {
      luxuryScore -= 12;
    }
  }

  badFitPenalty -= discouragedGroupHits * 34;
  badFitPenalty -= discouragedStyleHits * 18;
  badFitPenalty -= discouragedKeywordHits * 6;

  if (context.hasStrongInterestSignal && !hasInterestAffinity) {
    badFitPenalty -= 110;
  }

  if (context.hasClearRecipientIntent && !hasRecipientAffinity && !hasInterestAffinity) {
    badFitPenalty -= 92;
  }

  if (product.type === 'verified' && context.hasStrongInterestSignal && !hasInterestAffinity && !hasRecipientAffinity) {
    badFitPenalty -= 42;
  }

  if (product.type === 'concept' && context.confidence >= 0.52 && hasInterestAffinity) {
    luxuryScore += 12;
  }

  const mismatchPenalty = computeIntentMismatchPenalty(product, context);

  return {
    recipientScore,
    keywordScore,
    occasionScore,
    luxuryScore,
    badFitPenalty,
    diversityAdjustment: 0,
    totalScore: 12
      + recipientOnlyScore * 1.08
      + interestScore
      + styleToneScore * 0.9
      + occasionScore
      + luxuryScore
      + badFitPenalty
      + mismatchPenalty,
  };
}

function scoreOccasionRefinement(product, context, productGroups) {
  if (!context.selectedOccasion) {
    return countMatches(product.occasionTags, context.inferredOccasions) * 4;
  }

  const refinement = OCCASION_REFINEMENT_MAP[context.selectedOccasion];
  let score = product.occasionTags.includes(context.selectedOccasion) ? 12 : 0;

  if (!refinement) {
    return score;
  }

  score += countMatches(productGroups, refinement.preferredGroups || []) * 8;
  score += countMatches(product.styleTags, refinement.preferredStyles || []) * 4;
  score -= countMatches(productGroups, refinement.discouragedGroups || []) * 10;
  score -= countMatches(product.styleTags, refinement.discouragedStyles || []) * 2;

  return score;
}

function collectInputSignals(text) {
  const directRecipientTags = collectMappedTags(text, RECIPIENT_SIGNAL_MAP);
  const directInterestTags = collectMappedTags(text, INTEREST_INTENT_RULES.map((rule) => ({
    tag: rule.interestTags?.[0],
    patterns: rule.patterns,
  })).filter((rule) => rule.tag));
  const directStyleTags = collectMappedTags(text, STYLE_SIGNAL_MAP);
  const directCategoryTags = collectMappedTags(text, CATEGORY_SIGNAL_MAP);
  const semanticSignals = collectIntentSignals(text);

  return {
    recipientTags: unique([...directRecipientTags, ...semanticSignals.recipientTags]),
    interestTags: unique([...directInterestTags, ...semanticSignals.interestTags]),
    styleTags: unique([...directStyleTags, ...semanticSignals.styleTags]),
    categoryTags: unique([...directCategoryTags, ...semanticSignals.categoryTags]),
    keywordTags: semanticSignals.keywordTags,
    semanticTags: semanticSignals.semanticTags,
    preferredGroups: unique([...directCategoryTags, ...semanticSignals.preferredGroups]),
    badFit: {
      groups: semanticSignals.discouragedGroups,
      styles: semanticSignals.discouragedStyles,
      keywords: semanticSignals.discouragedKeywords,
    },
    hasClearRecipientIntent: semanticSignals.hasClearRecipientIntent || directRecipientTags.length > 0,
  };
}

function collectIntentSignals(text) {
  const normalizedText = normalizeSearchText(text);
  const emptySignals = {
    semanticTags: [],
    recipientTags: [],
    interestTags: [],
    styleTags: [],
    categoryTags: [],
    keywordTags: [],
    preferredGroups: [],
    discouragedGroups: [],
    discouragedStyles: [],
    discouragedKeywords: [],
    hasClearRecipientIntent: false,
  };

  if (!normalizedText) {
    return emptySignals;
  }

  return [...PROFILE_INTENT_RULES, ...INTEREST_INTENT_RULES].reduce((signals, rule) => {
    const matchesRule = rule.patterns.some((pattern) => normalizedText.includes(pattern));

    if (!matchesRule) {
      return signals;
    }

    return {
      semanticTags: unique([...signals.semanticTags, ...(rule.semanticTags || [])]),
      recipientTags: unique([...signals.recipientTags, ...(rule.recipientTags || [])]),
      interestTags: unique([...signals.interestTags, ...(rule.interestTags || [])]),
      styleTags: unique([...signals.styleTags, ...(rule.styleTags || [])]),
      categoryTags: unique([...signals.categoryTags, ...(rule.categoryTags || [])]),
      keywordTags: unique([...signals.keywordTags, ...(rule.keywordTags || [])]),
      preferredGroups: unique([...signals.preferredGroups, ...(rule.preferredGroups || [])]),
      discouragedGroups: unique([...signals.discouragedGroups, ...(rule.discouragedGroups || [])]),
      discouragedStyles: unique([...signals.discouragedStyles, ...(rule.discouragedStyles || [])]),
      discouragedKeywords: unique([...signals.discouragedKeywords, ...(rule.discouragedKeywords || [])]),
      hasClearRecipientIntent: signals.hasClearRecipientIntent || Boolean(rule.hasClearRecipientIntent),
    };
  }, emptySignals);
}

function mergeSignalSets(...signalSets) {
  return signalSets.reduce((merged, signals) => {
    const signalSet = signals || {};

    return {
      recipientTags: unique([...merged.recipientTags, ...(signalSet.recipientTags || [])]),
      interestTags: unique([...merged.interestTags, ...(signalSet.interestTags || [])]),
      styleTags: unique([...merged.styleTags, ...(signalSet.styleTags || [])]),
      categoryTags: unique([...merged.categoryTags, ...(signalSet.categoryTags || [])]),
      keywordTags: unique([...merged.keywordTags, ...(signalSet.keywordTags || [])]),
      semanticTags: unique([...merged.semanticTags, ...(signalSet.semanticTags || [])]),
      preferredGroups: unique([...merged.preferredGroups, ...(signalSet.preferredGroups || [])]),
      badFit: {
        groups: unique([...merged.badFit.groups, ...(signalSet.badFit?.groups || [])]),
        styles: unique([...merged.badFit.styles, ...(signalSet.badFit?.styles || [])]),
        keywords: unique([...merged.badFit.keywords, ...(signalSet.badFit?.keywords || [])]),
      },
      hasClearRecipientIntent: merged.hasClearRecipientIntent || Boolean(signalSet.hasClearRecipientIntent),
    };
  }, {
    recipientTags: [],
    interestTags: [],
    styleTags: [],
    categoryTags: [],
    keywordTags: [],
    semanticTags: [],
    preferredGroups: [],
    badFit: {
      groups: [],
      styles: [],
      keywords: [],
    },
    hasClearRecipientIntent: false,
  });
}

function getProductGroupTags(product) {
  return collectMappedTags(getProductSearchText(product), PRODUCT_GROUP_SIGNAL_MAP);
}

function scoreKeywordMatches(haystack, keywords, longMatchScore = 4, shortMatchScore = 2, maxScore = 18) {
  if (!Array.isArray(keywords) || !keywords.length) {
    return 0;
  }

  let score = 0;

  keywords.forEach((keyword) => {
    if (haystack.includes(keyword)) {
      score += keyword.length > 8 ? longMatchScore : shortMatchScore;
    }
  });

  return Math.min(score, maxScore);
}

function scoreTokenMatches(haystack, tokens) {
  let score = 0;

  tokens.forEach((token) => {
    if (haystack.includes(token)) {
      score += token.length > 6 ? 3 : 1;
    }
  });

  return Math.min(score, 12);
}

function countMatches(productTags, activeTags) {
  if (!Array.isArray(productTags) || !Array.isArray(activeTags) || !activeTags.length) {
    return 0;
  }

  const activeSet = new Set(activeTags);
  return productTags.reduce((count, tag) => (activeSet.has(tag) ? count + 1 : count), 0);
}

function countCategoryMatches(product, categoryTags) {
  if (!Array.isArray(categoryTags) || !categoryTags.length) {
    return 0;
  }

  const productGroups = getProductGroupTags(product);
  const groupMatches = countMatches(productGroups, categoryTags);
  const haystack = getProductSearchText(product);
  const textMatches = categoryTags.reduce((count, tag) => {
    if (productGroups.includes(tag)) {
      return count;
    }

    return haystack.includes(tag.replace(/-/g, ' ')) ? count + 1 : count;
  }, 0);

  return groupMatches + textMatches;
}

function getProductSearchText(product) {
  return normalizeSearchText([
    product.title,
    product.brand,
    product.category,
    product.description,
    product.reasoning || '',
    product.recipientTags.join(' '),
    (product.interestTags || []).join(' '),
    product.styleTags.join(' '),
    product.occasionTags.join(' '),
    (product.imageTags || []).join(' '),
    (product.tags || []).join(' '),
    product.searchTerm || '',
  ].join(' '));
}

function getTargetPrice(context) {
  if (context.priceSensitivity === 'budget') {
    return 3500;
  }

  if (context.priceSensitivity === 'premium' || context.luxurySelected) {
    return 22000;
  }

  return 9000;
}

function isLuxuryProduct(product) {
  return getComparablePrice(product) >= 12000 || product.styleTags.includes('luxury');
}

function getComparablePrice(product) {
  if (Number.isFinite(Number(product?.comparablePrice))) {
    return Number(product.comparablePrice);
  }

  if (Number.isFinite(Number(product?.price))) {
    return Number(product.price);
  }

  return 6999;
}

function pickDiverseProducts(products, limit) {
  const selected = [];
  const seenCategories = new Set();

  products.forEach((product) => {
    if (selected.length >= limit) {
      return;
    }

    if (!seenCategories.has(product.category) || selected.length < Math.min(3, limit)) {
      selected.push(product);
      seenCategories.add(product.category);
    }
  });

  products.forEach((product) => {
    if (selected.length >= limit || selected.includes(product)) {
      return;
    }

    selected.push(product);
  });

  return selected.slice(0, limit);
}

function collectMappedTags(text, mappings) {
  const normalizedText = normalizeSearchText(text);

  if (!normalizedText) {
    return [];
  }

  return unique(
    mappings
      .filter(({ patterns }) => patterns.some((pattern) => normalizedText.includes(pattern)))
      .map(({ tag }) => tag),
  );
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value) {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 3 && !COMMON_PROFILE_TOKENS.has(token));
}

function normalizeUiTag(value) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.replace(/\s+/g, '-') : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pickPrimaryRecipientTag(recipientTags) {
  if (!Array.isArray(recipientTags) || !recipientTags.length) {
    return '';
  }

  const preferredOrder = ['teacher', 'brother', 'sister', 'partner', 'friend', 'dad', 'mom', 'boss', 'coworker', 'traveler'];
  return preferredOrder.find((tag) => recipientTags.includes(tag)) || recipientTags[0];
}

function inferPriceSensitivity(profile, normalizedTags) {
  const haystack = normalizeSearchText(profile);
  const tagText = normalizeSearchText(normalizedTags.join(' '));

  if (normalizedTags.includes('luxury') || /luxury|premium|splurge|high end|upscale/.test(`${haystack} ${tagText}`)) {
    return 'premium';
  }

  if (/budget|affordable|under|cheap|value/.test(`${haystack} ${tagText}`)) {
    return 'budget';
  }

  return 'balanced';
}

function computeIntentConfidence({ rawProfile, recipientTags, interestTags, styleTags, categoryTags, occasion, avoidTags }) {
  const normalizedProfile = normalizeSearchText(rawProfile);
  let confidence = normalizedProfile.length > 12 ? 0.22 : 0.1;
  confidence += Math.min(0.3, recipientTags.length * 0.14);
  confidence += Math.min(0.26, interestTags.length * 0.09);
  confidence += Math.min(0.12, styleTags.length * 0.045);
  confidence += Math.min(0.14, categoryTags.length * 0.045);
  confidence += occasion ? 0.06 : 0;
  confidence += avoidTags.length ? 0.04 : 0;
  return Math.max(0.12, Math.min(0.96, confidence));
}

function buildClarifyingPromptItem(context, rankedProducts) {
  const question = getClarifyingQuestion(context, rankedProducts);

  if (!question) {
    return null;
  }

  const topConcept = rankedProducts.find((entry) => entry.product.type === 'concept')?.product;

  return buildRenderableClarificationItem({
    id: `clarify-${hashString(`${context.rawProfile}-${question}`)}`,
    type: 'clarify',
    title: 'One quick question',
    category: 'Clarify the brief',
    description: question,
    tags: unique([...context.interestTags, ...context.styleTags]).slice(0, 6),
    recipientTags: context.recipientTags,
    interestTags: context.interestTags,
    styleTags: context.styleTags,
    occasionTags: context.occasion ? [context.occasion] : [],
    imageTags: topConcept?.imageTags || ['desk', 'gift'],
    image: topConcept?.image || CLARIFY_FALLBACK_IMAGE,
  });
}

function getClarifyingQuestion(context, rankedProducts) {
  const topScore = rankedProducts[0]?.scoreBreakdown?.totalScore ?? 0;
  const sparseIntent = !context.recipientTags.length && !context.interestTags.length && !context.styleTags.length && !context.categoryTags.length;

  if (sparseIntent || context.confidence < 0.36 || topScore < 20) {
    return 'Should I lean books and desk items, coffee rituals, travel gear, or tech accessories?';
  }

  if (context.recipientType === 'friend' && !context.interestTags.length && context.confidence < 0.52) {
    return 'Would they prefer something practical, decorative, or tech-forward?';
  }

  if (context.recipientType === 'partner' && !context.interestTags.length && !context.styleTags.length) {
    return 'Would they prefer something practical, decorative, or experience-led?';
  }

  if (context.recipientType === 'traveler' && !context.interestTags.length) {
    return 'Should I focus on compact travel gear, reading picks, or portable tech?';
  }

  if (!context.interestTags.length && context.recipientTags.includes('teacher')) {
    return 'Would they enjoy books and desk tools more, or coffee and classroom comforts?';
  }

  return '';
}

function renderResults(items, resultsArea, contextLabel, bindCursorTargets, bindTilts, context) {
  const normalizedItems = prepareRenderableRecommendations(items, context, 6);

  resultsArea.classList.remove('hidden');
  resultsArea.innerHTML = normalizedItems
    .map((item, index) => {
      const label = getResultChipLabel(item, index);
      const footerText = getResultFooterText(item);
      // Update CTA text based on item type
      let ctaText;
      if (item.type === 'clarify') {
        ctaText = 'Refine prompt';
      } else if (item.type === 'concept') {
        ctaText = 'Explore idea';
      } else {
        ctaText = 'View details';
      }
      
      const imageQuery = item.imageSearchQuery || item.searchTerm || item.title || '';
      const wishSaved = wishlistIdSet.has(item.id);
      const wishClass = wishSaved ? 'result-card__wish is-saved' : 'result-card__wish';
      
      // Add type badge for concept items
      const typeBadge = item.type === 'concept' ? '<span class="result-type-badge">Concept Idea</span>' : '';

      return `
        <article class="result-card zoom-in-hover" data-product-id="${escapeHtml(item.id)}" data-gift-type="${escapeHtml(item.type)}" data-image-query="${escapeHtml(imageQuery)}">
          <div class="result-card__media">
            <img src="${resolveAssetPath(item.image)}" alt="${escapeHtml(item.title)}" class="card-img" />
            ${item.type === 'clarify' ? '' : `<button type="button" class="${wishClass}" data-wish-id="${escapeHtml(item.id)}" aria-pressed="${wishSaved ? 'true' : 'false'}" aria-label="Save to wishlist">♥</button>`}
            <span class="result-chip">${escapeHtml(label)}</span>
            ${typeBadge}
          </div>
          <div class="result-card__body">
            <span class="result-card__eyebrow">${escapeHtml(contextLabel)}</span>
            <h3 class="result-title">${escapeHtml(item.title)}</h3>
            <p class="result-desc">${escapeHtml(item.description)}</p>
          </div>
          <div class="result-card__footer">
            ${footerText ? `<span class="result-price">${escapeHtml(footerText)}</span>` : ''}
            <span class="result-cta">${escapeHtml(ctaText)}</span>
          </div>
        </article>
      `;
    })
    .join('');

  window.currentMockItems = normalizedItems;
  window.currentMockItemsById = new Map(normalizedItems.map((item) => [item.id, item]));
  const cards = resultsArea.querySelectorAll('.result-card');
  cards.forEach((card, index) => {
    const item = normalizedItems[index];
    if (!item) return;
    card.dataset.itemId = item.id;
    card.__giftItem = item;
    console.log('[CARD IMAGE]', item.title, item.image);
  });
  bindCursorTargets(cards);
  bindTilts(cards);

  if (!reducedMotion) {
    gsap.from(cards, {
      y: 24,
      opacity: 0,
      duration: 0.6,
      stagger: 0.1,
      ease: 'power3.out',
    });
  }

  void hydrateResultImages(normalizedItems, resultsArea);
}

function prepareRenderableRecommendations(items, context, limit = 6) {
  const candidatePool = Array.isArray(items) ? items : [];
  const clarificationItem = candidatePool.find((item) => item?.type === 'clarify');

  if (clarificationItem) {
    return [buildRenderableGiftItem(clarificationItem)].filter(Boolean);
  }

  const prepared = [];
  const usedIds = new Set();

  candidatePool.forEach((item) => {
    const normalizedItem = buildRenderableGiftItem(item);

    if (!normalizedItem || usedIds.has(normalizedItem.id)) {
      return;
    }

    usedIds.add(normalizedItem.id);
    prepared.push(normalizedItem);
  });

  const backendValidCount = prepared.length;
  if (prepared.length >= 4) {
    const finalItems = prepared.slice(0, limit);
    assertRenderableRecommendationContract(finalItems, {
      source: 'backend',
      padded: false,
      backendValidCount,
    });
    return finalItems;
  }

  const fallbackPool = getFallbackCatalogProducts(context, Math.max(limit * 2, 8));
  fallbackPool.forEach((item) => {
    const normalizedItem = buildRenderableGiftItem(item);

    if (!normalizedItem || usedIds.has(normalizedItem.id)) {
      return;
    }

    usedIds.add(normalizedItem.id);
    prepared.push(normalizedItem);
  });

  const finalItems = prepared.slice(0, limit);
  assertRenderableRecommendationContract(finalItems, {
    source: 'backend-plus-local-fallback',
    padded: finalItems.length > backendValidCount,
    backendValidCount,
  });
  return finalItems;
}

function assertRenderableRecommendationContract(items, detail = {}) {
  if (!DEV_CONTRACT_ASSERTIONS) {
    return;
  }

  if (detail.backendValidCount >= 4 && detail.padded) {
    devContractWarn('Sufficient backend results were padded locally.', detail);
  }

  (items || []).forEach((item) => {
    if (!item || item.type === 'clarify') {
      return;
    }

    const marketplaceLinks = item.marketplaceLinks && typeof item.marketplaceLinks === 'object' ? item.marketplaceLinks : {};
    const marketplacePrices = item.marketplacePrices && typeof item.marketplacePrices === 'object' ? item.marketplacePrices : {};
    const linkCount = Object.keys(marketplaceLinks).length;
    const priceCount = Object.keys(marketplacePrices).length;
    const buyPlatformCount = Array.isArray(item.buyPlatforms) ? item.buyPlatforms.length : 0;

    if (item.type === 'concept' && (linkCount || priceCount || buyPlatformCount)) {
      devContractWarn('Concept recommendation contains commerce fields.', {
        id: item.id,
        linkCount,
        priceCount,
        buyPlatformCount,
      });
    }

    if (item.type === 'verified') {
      const explicitValidPlatforms = getBuyPlatforms(item);
      if (buyPlatformCount && item.buyPlatforms.some((platform) => !explicitValidPlatforms.includes(platform))) {
        devContractWarn('Verified recommendation exposes buyPlatforms without explicit valid links.', {
          id: item.id,
          buyPlatforms: item.buyPlatforms,
          explicitValidPlatforms,
        });
      }
    }
  });
}

function getFallbackCatalogProducts(context, limit) {
  // Gracefully fallback to the organic ranking algorithm using the new expanded catalog
  return selectCatalogProducts(rankCatalogProducts(context), limit, context);
}

function getResultChipLabel(item, index) {
  if (item?.type === 'concept') {
    return 'Concept idea';
  }

  if (item?.type === 'clarify') {
    return 'Clarify first';
  }

  return RESULT_LABELS[index % RESULT_LABELS.length];
}

function getResultFooterText(item) {
  if (item?.type === 'clarify') {
    return 'Need one detail';
  }

  // Concept items NEVER show pricing
  if (item?.type === 'concept') {
    return '';
  }

  // Only verified items MAY show pricing - but ONLY if 2+ real prices exist
  if (item?.type === 'verified' && item?.validationStatus === 'verified') {
    const realPrices = getPricePlatforms(item);
    // Require 2+ real marketplace prices to show "From INR"
    if (realPrices.length >= 2) {
      const prices = realPrices
        .map((entry) => Number(entry.price))
        .filter((price) => Number.isFinite(price) && price > 0);
      return prices.length > 0 ? `From INR ${Math.min(...prices).toLocaleString('en-IN')}` : '';
    }
    return '';
  }

  // Default - no pricing
  return '';
}

function getLowestMarketplacePrice(item) {
  if (item?.type !== 'verified' || item?.validationStatus !== 'verified') {
    return 0;
  }
  const st = item.searchTerm || item.title;
  const prices = MARKETPLACE_ORDER
    .filter((platform) => {
      const link = item?.marketplaceLinks?.[platform];
      return link && isMarketplaceLinkValid(platform, link, st);
    })
    .map((platform) => Number(item?.marketplacePrices?.[platform]))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function getBuyPlatforms(item) {
  if (item?.type !== 'verified' || item?.validationStatus !== 'verified') {
    return [];
  }
  const st = item?.searchTerm || item?.title || '';
  return MARKETPLACE_ORDER.filter((platform) => {
    const link = item?.marketplaceLinks?.[platform];
    if (!link || typeof link !== 'string' || !/^https?:\/\//i.test(link)) {
      return false;
    }
    if (!MARKETPLACE_CONFIG[platform]?.domainPattern?.test(link)) {
      return false;
    }
    return isMarketplaceLinkValid(platform, link, st);
  });
}

function getPricePlatforms(item) {
  const prepared = ensureModalPrices(item || {});
  return PLATFORM_ORDER.map((platform) => ({
    platform,
    price: prepared.marketplacePrices[platform],
  }));
}

function parseMarketplacePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function fillMissingPlatformDataVerified(item, basePrice) {
  const searchTerm = item.searchTerm || item.title;
  MARKETPLACE_ORDER.forEach((platform) => {
    if (item.marketplaceLinks[platform] && !isMarketplaceLinkValid(platform, item.marketplaceLinks[platform], searchTerm)) {
      delete item.marketplaceLinks[platform];
      delete item.marketplacePrices[platform];
    }
  });

  MARKETPLACE_ORDER.forEach((platform) => {
    if (!item.marketplaceLinks[platform]) {
      delete item.marketplacePrices[platform];
    }
  });
}

function fillMissingPlatformDataConcept(item) {
  if (!item.marketplaceLinks || typeof item.marketplaceLinks !== 'object') {
    item.marketplaceLinks = {};
  }
  if (!item.marketplacePrices || typeof item.marketplacePrices !== 'object') {
    item.marketplacePrices = {};
  }
}

function fillMissingPlatformData(item, basePrice) {
  if (!item.marketplaceLinks) {
    item.marketplaceLinks = {};
  }
  if (!item.marketplacePrices) {
    item.marketplacePrices = {};
  }

  if (item.type === 'concept') {
    fillMissingPlatformDataConcept(item);
  } else if (item.type === 'verified') {
    fillMissingPlatformDataVerified(item, basePrice);
  }

  applyAffiliateToAllMarketplaceLinks(item);
}

function buildRenderableGiftItem(item, options = {}) {
  if (!item) {
    return null;
  }

  if (item.type === 'verified') {
    return buildRenderableProduct(item, options);
  }

  if (item.type === 'clarify') {
    return buildRenderableClarificationItem(item);
  }

  // Default to concept
  return buildRenderableConcept(item, options);
}

function buildRenderableProduct(product, options = {}) {
  if (!product) {
    return null;
  }

  const title = sanitizeText(product.title, '', 120);
  if (!title) {
    return null;
  }

  const searchTerm = sanitizeText(product.searchTerm, title, 140);
  const category = sanitizeText(product.category, 'Gift', 80);
  const enrichedLinks = enrichMarketplaceLinks(product, searchTerm);
  const requestedPlatforms = normalizePlatformKeys(Object.keys(enrichedLinks || {}));
  const marketplacePrices = normalizeMarketplacePrices(product.marketplacePrices, requestedPlatforms);
  const candidate = {
    id: sanitizeText(product.id, normalizeUiTag(title) || 'catalog-item', 80),
    type: 'verified',
    verified: true,
    title,
    brand: sanitizeText(product.brand, '', 60),
    category,
    description: sanitizeText(product.description || product.desc, 'A polished gift pick tailored to the moment.', 220),
    image: sanitizeImage(product.image || product.img),
    imageSearchQuery: sanitizeText(product.imageSearchQuery, searchTerm, 200),
    recipientTags: normalizeTagList(product.recipientTags),
    occasionTags: normalizeTagList(product.occasionTags),
    styleTags: normalizeTagList(product.styleTags),
    interestTags: normalizeTagList(product.interestTags),
    tags: normalizeTagList(product.tags),
    imageTags: normalizeTagList(product.imageTags),
    searchTerm,
    marketplaceLinks: normalizeMarketplaceLinks(enrichedLinks, requestedPlatforms),
    marketplacePrices,
    comparablePrice: getComparablePriceFromMap(marketplacePrices, null),
    rankPrice: null,
    validationStatus: sanitizeText(product.validationStatus, 'pending', 24),
    reason: sanitizeText(options.reason ?? product.reason, '', 120),
  };

  fillMissingPlatformData(candidate, null);
  candidate.buyPlatforms = getBuyPlatforms(candidate);
  console.log(`[price-cleanup] ${candidate.title} ${Object.keys(candidate.marketplacePrices || {}).length}`);
  console.log(`[marketplace] ${candidate.title} ${Object.keys(candidate.marketplaceLinks || {}).join(', ') || 'none'}`);

  if (!validateRenderableProduct(candidate)) {
    return null;
  }

  return candidate;
}

function buildRenderableConcept(concept, options = {}) {
  if (!concept) {
    return null;
  }

  const title = sanitizeText(concept.title, '', 120);
  if (!title) {
    return null;
  }

  const category = sanitizeText(concept.category, 'Gift idea', 80);
  const candidate = {
    id: sanitizeText(concept.id, normalizeUiTag(title) || 'concept-item', 80),
    type: 'concept',
    verified: false,
    title,
    brand: '',
    category,
    description: sanitizeText(concept.description || concept.desc, 'A concept gift idea tailored to the moment.', 220),
    reasoning: sanitizeText(options.reason || concept.reasoning, '', 180),
    tags: normalizeTagList(concept.tags || [...(concept.interestTags || []), ...(concept.styleTags || [])]),
    image: sanitizeImage(concept.image || concept.img),
    imageSearchQuery: sanitizeText(concept.imageSearchQuery, title, 200),
    recipientTags: normalizeTagList(concept.recipientTags),
    occasionTags: normalizeTagList(concept.occasionTags),
    styleTags: normalizeTagList(concept.styleTags),
    interestTags: normalizeTagList(concept.interestTags),
    imageTags: normalizeTagList(concept.imageTags),
    marketplaceLinks: concept.marketplaceLinks || {},
    marketplacePrices: concept.marketplacePrices || {},
    comparablePrice: null,
    rankPrice: null,
    buyPlatforms: [],
    validationStatus: sanitizeText(concept.validationStatus, 'concept', 24),
    reason: sanitizeText(options.reason ?? concept.reason, '', 120),
  };

  fillMissingPlatformData(candidate, null);

  if (!validateRenderableConcept(candidate)) {
    return null;
  }

  return candidate;
}

function buildRenderableClarificationItem(item) {
  if (!item) {
    return null;
  }

  return {
    id: sanitizeText(item.id, 'clarify-gift-prompt', 80),
    type: 'clarify',
    verified: false,
    title: sanitizeText(item.title, 'One quick question', 120),
    brand: '',
    category: sanitizeText(item.category, 'Clarify the brief', 80),
    description: sanitizeText(item.description, 'A little more detail will improve the shortlist.', 220),
    reasoning: '',
    tags: normalizeTagList(item.tags),
    image: sanitizeImage(item.image) || CLARIFY_FALLBACK_IMAGE,
    recipientTags: normalizeTagList(item.recipientTags),
    occasionTags: normalizeTagList(item.occasionTags),
    styleTags: normalizeTagList(item.styleTags),
    interestTags: normalizeTagList(item.interestTags),
    imageTags: normalizeTagList(item.imageTags),
    marketplaceLinks: {},
    marketplacePrices: {},
    comparablePrice: 0,
    validationStatus: 'clarify',
    reason: '',
  };
}

function sanitizeImage(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const aliasMap = {
    '/perfume.png': '/elegant_perfume.png',
    '/wallet.png': '/sleek_wallet.png',
    '/plant.png': '/zen_garden.png',
  };
  const trimmed = aliasMap[value.trim()] || value.trim();
  if (DISALLOWED_PLACEHOLDER_IMAGES.has(trimmed)) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return ALLOWED_IMAGES.has(trimmed) ? trimmed : '';
}

function normalizeTagList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return unique(values.map((value) => sanitizeText(value, '', 40)));
}

function normalizePlatformKeys(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return unique(values.map((value) => normalizeSearchText(value)).filter((value) => MARKETPLACE_ORDER.includes(value)));
}

function normalizeMarketplaceLinks(value, platforms) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return platforms.reduce((links, platform) => {
    const sanitized = sanitizeUrl(value[platform], '');

    if (sanitized) {
      links[platform] = sanitized;
    }

    return links;
  }, {});
}

function normalizeMarketplacePrices(value, platforms) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return platforms.reduce((priceMap, platform) => {
    const price = Number.parseInt(value[platform], 10);

    if (Number.isFinite(price) && price > 0) {
      priceMap[platform] = price;
    }

    return priceMap;
  }, {});
}

function getComparablePriceFromMap(priceMap, fallback) {
  const prices = Object.values(priceMap || {}).filter((price) => Number.isFinite(Number(price)));
  return prices.length ? Math.min(...prices) : fallback;
}

function validateRenderableProduct(product) {
  return Boolean(product?.title && product?.image);
}

function validateRenderableConcept(item) {
  if (item?.type !== 'concept') {
    return false;
  }

  if (!item?.id || !item?.title || !item?.description || !item?.category || !item?.image) {
    return false;
  }

  return true;
}

function isImageAligned(product) {
  const identityText = normalizeSearchText([
    product.title,
    product.brand,
    product.category,
    product.description,
    product.searchTerm || '',
    product.reasoning || '',
    (product.tags || []).join(' '),
  ].join(' '));

  return product.imageTags.some((tag) => {
    const normalizedTag = normalizeSearchText(tag);
    return normalizedTag && identityText.includes(normalizedTag);
  });
}

function isMarketplaceLinkValid(platform, url, searchTerm) {
  const config = MARKETPLACE_CONFIG[platform];
  if (!config || !url || !config.domainPattern.test(url)) {
    return false;
  }

  const normalizedUrl = normalizeSearchText(decodeURIComponent(url));
  const queryTokens = tokenizeText(searchTerm).filter((token) => token.length > 3);
  const looksLikeSearchUrl = /[?&](?:k|q)=|\/search\b|\/s\b/.test(url);

  if (!queryTokens.length || !looksLikeSearchUrl) {
    return true;
  }

  return queryTokens.every((token) => normalizedUrl.includes(token));
}

/**
 * Backend image scoring is the source of truth for verified product photos.
 * Keep this permissive so valid CDN URLs are not rejected by URL token mismatch.
 */
function remoteImageLikelyMatchesIdentity(item, imageUrl) {
  return typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl);
}

function applyAffiliateToAllMarketplaceLinks(item) {
  if (!item?.marketplaceLinks) {
    return;
  }
  MARKETPLACE_ORDER.forEach((platform) => {
    if (item.marketplaceLinks[platform]) {
      item.marketplaceLinks[platform] = applyAffiliateToMarketplaceUrl(item.marketplaceLinks[platform], platform);
    }
  });
}

function hashString(value) {
  return String(value).split('').reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
}

function sanitizeText(value, fallback, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  return value.trim().slice(0, maxLength);
}

function sanitizeUrl(value, fallback) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return fallback;
  }

  return value;
}

let currentAuthUser = null;
let wishlistUnsub = () => {};
let remoteWishlistCache = [];

function updateWishlistNavCount() {
  const pill = document.getElementById('wishlistCount');
  if (!pill) {
    return;
  }
  const n = wishlistIdSet.size;
  if (n > 0) {
    pill.hidden = false;
    pill.textContent = String(n);
  } else {
    pill.hidden = true;
  }
}

function getWishlistRowsForUi() {
  if (currentAuthUser?.uid && isFirebaseConfigured()) {
    return remoteWishlistCache;
  }
  return readLocalWishlist();
}

function renderWishlistDrawerBody() {
  const body = document.getElementById('wishlistDrawerBody');
  if (!body) {
    return;
  }

  const list = getWishlistRowsForUi();
  recomputeWishlistIdSetFromRows(list);

  if (!list.length) {
    body.innerHTML = '<p class="wishlist-empty">Save gifts with the heart on each card. Sign in to sync across sessions.</p>';
    updateWishlistNavCount();
    return;
  }

  body.innerHTML = list.map((row) => `
    <div class="wishlist-row" data-wish-row="${escapeHtml(row.id)}">
      <img class="wishlist-row__img" src="${resolveAssetPath(row.image)}" alt="" />
      <div class="wishlist-row__meta">
        <p class="wishlist-row__title">${escapeHtml(row.title || 'Saved gift')}</p>
        <div class="wishlist-row__actions">
          <button type="button" class="secondary-btn wishlist-remove" data-remove-id="${escapeHtml(row.id)}">Remove</button>
        </div>
      </div>
    </div>
  `).join('');

  body.querySelectorAll('.wishlist-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rid = btn.getAttribute('data-remove-id') || '';
      const uid = currentAuthUser?.uid;
      try {
        if (uid && isFirebaseConfigured()) {
          await removeWishlistItem(uid, rid);
        } else {
          const next = readLocalWishlist().filter((r) => r.id !== rid);
          writeLocalWishlist(next);
          recomputeWishlistIdSetFromRows(next);
        }
      } catch (e) {
        console.warn(e);
      }
      renderWishlistDrawerBody();
      syncWishlistHeartsInResults();
    });
  });

  updateWishlistNavCount();
}

function syncWishlistHeartsInResults() {
  const resultsArea = document.getElementById('resultsArea');
  if (!resultsArea) {
    return;
  }
  resultsArea.querySelectorAll('.result-card__wish').forEach((btn) => {
    const id = btn.getAttribute('data-wish-id') || '';
    const on = wishlistIdSet.has(id);
    btn.classList.toggle('is-saved', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

async function toggleWishlistForItem(item, buttonEl) {
  const payload = wishlistPayloadFromItem(item);
  if (!payload) {
    return;
  }

  const uid = currentAuthUser?.uid;
  const wasOn = wishlistIdSet.has(item.id);

  try {
    if (uid && isFirebaseConfigured()) {
      if (wasOn) {
        await removeWishlistItem(uid, item.id);
        wishlistIdSet.delete(item.id);
      } else {
        await saveWishlistItem(uid, payload);
        wishlistIdSet.add(item.id);
      }
    } else {
      const rows = readLocalWishlist();
      const next = wasOn ? rows.filter((r) => r.id !== item.id) : [...rows, payload];
      writeLocalWishlist(next);
      recomputeWishlistIdSetFromRows(next);
      buttonEl.classList.toggle('is-saved', wishlistIdSet.has(item.id));
      buttonEl.setAttribute('aria-pressed', wishlistIdSet.has(item.id) ? 'true' : 'false');
    }
  } catch (e) {
    if (uid && isFirebaseConfigured()) {
      if (wasOn) {
        wishlistIdSet.add(item.id);
      } else {
        wishlistIdSet.delete(item.id);
      }
    }
    console.warn(e);
    return;
  }

  if (uid && isFirebaseConfigured()) {
    buttonEl.classList.toggle('is-saved', wishlistIdSet.has(item.id));
    buttonEl.setAttribute('aria-pressed', wishlistIdSet.has(item.id) ? 'true' : 'false');
  }

  renderWishlistDrawerBody();
  syncWishlistHeartsInResults();
}

async function mergeLocalWishlistToCloud(uid) {
  const local = readLocalWishlist();
  if (!local.length) {
    return;
  }
  for (const row of local) {
    try {
      await saveWishlistItem(uid, row);
    } catch {
      /* ignore */
    }
  }
  writeLocalWishlist([]);
}

function setupWishlistAuth(bindCursorTargets) {
  recomputeWishlistIdSetFromRows(readLocalWishlist());
  renderWishlistDrawerBody();

  const drawer = document.getElementById('wishlistDrawer');
  const navWish = document.getElementById('navWishlistBtn');
  const backdrop = document.getElementById('wishlistDrawerBackdrop');
  const closeDrawer = document.getElementById('wishlistDrawerClose');
  const authBtn = document.getElementById('navAuthBtn');
  const authModal = document.getElementById('authModal');
  const authClose = document.getElementById('authModalClose');
  const authPrimary = document.getElementById('authPrimaryBtn');
  const authToggle = document.getElementById('authToggleMode');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authError = document.getElementById('authError');
  const authTitle = document.getElementById('authModalTitle');
  const authSubtitle = document.getElementById('authModalSubtitle');

  let authMode = 'signin';

  const setAuthError = (msg) => {
    if (!authError) {
      return;
    }
    if (!msg) {
      authError.hidden = true;
      authError.textContent = '';
      return;
    }
    authError.hidden = false;
    authError.textContent = msg;
  };

  const syncAuthCopy = () => {
    if (!authTitle || !authSubtitle || !authPrimary || !authToggle) {
      return;
    }
    if (authMode === 'signin') {
      authTitle.textContent = 'Welcome back';
      authSubtitle.textContent = 'Sign in to sync your wishlist across devices.';
      authPrimary.textContent = 'Sign in';
      authToggle.textContent = 'Create an account';
    } else {
      authTitle.textContent = 'Create your account';
      authSubtitle.textContent = 'Save hearts to the cloud and pick up where you left off.';
      authPrimary.textContent = 'Sign up';
      authToggle.textContent = 'I already have an account';
    }
  };

  const openDrawer = () => {
    if (!drawer) {
      return;
    }
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    navWish?.setAttribute('aria-expanded', 'true');
    renderWishlistDrawerBody();
  };

  const closeDrawerFn = () => {
    if (!drawer) {
      return;
    }
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
    navWish?.setAttribute('aria-expanded', 'false');
  };

  navWish?.addEventListener('click', () => {
    if (drawer?.classList.contains('hidden')) {
      openDrawer();
    } else {
      closeDrawerFn();
    }
  });
  backdrop?.addEventListener('click', closeDrawerFn);
  closeDrawer?.addEventListener('click', closeDrawerFn);

  const openAuth = () => {
    if (!authModal) {
      return;
    }
    setAuthError('');
    authModal.classList.remove('hidden');
  };

  const closeAuth = () => {
    authModal?.classList.add('hidden');
    setAuthError('');
  };

  authClose?.addEventListener('click', closeAuth);
  authModal?.addEventListener('click', (event) => {
    if (event.target === authModal) {
      closeAuth();
    }
  });

  authToggle?.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    syncAuthCopy();
    setAuthError('');
  });

  authPrimary?.addEventListener('click', async () => {
    if (!isFirebaseConfigured()) {
      setAuthError('Firebase is not configured. Add VITE_FIREBASE_* keys to your .env file.');
      return;
    }
    const email = authEmail?.value?.trim() || '';
    const password = authPassword?.value || '';
    if (!email || !password) {
      setAuthError('Enter email and password.');
      return;
    }
    setAuthError('');
    try {
      if (authMode === 'signin') {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password);
      }
      closeAuth();
    } catch (e) {
      setAuthError(e?.message || 'Authentication failed');
    }
  });

  authBtn?.addEventListener('click', async () => {
    if (currentAuthUser) {
      await signOutUser();
      return;
    }
    openAuth();
  });

  subscribeAuth((user) => {
    wishlistUnsub();
    wishlistUnsub = () => {};
    currentAuthUser = user;

    if (user) {
      if (authBtn) {
        authBtn.textContent = 'Log out';
      }
      if (isFirebaseConfigured()) {
        mergeLocalWishlistToCloud(user.uid).finally(() => {
          wishlistUnsub = subscribeWishlistItems(user.uid, (items) => {
            remoteWishlistCache = items.map((it) => ({ ...it }));
            renderWishlistDrawerBody();
            syncWishlistHeartsInResults();
          });
        });
      }
    } else {
      if (authBtn) {
        authBtn.textContent = 'Log in';
      }
      remoteWishlistCache = [];
      recomputeWishlistIdSetFromRows(readLocalWishlist());
      renderWishlistDrawerBody();
      syncWishlistHeartsInResults();
    }
  });

  syncAuthCopy();
  bindCursorTargets?.([navWish, authBtn, authPrimary, authToggle, authClose, backdrop, closeDrawer].filter(Boolean));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case '\'':
        return '&#39;';
      default:
        return character;
    }
  });
}

function setupModal() {
  const modalOverlay = document.getElementById('productModal');
  const modalContent = modalOverlay?.querySelector('.modal-content');
  const closeButton = document.getElementById('closeModal');
  const modalImg = document.getElementById('modalImg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const priceGraph = document.getElementById('priceGraph');
  const priceGraphContainer = priceGraph?.closest('.price-graph-container');
  const resultsArea = document.getElementById('resultsArea');
  const collectionCards = document.querySelectorAll('.collection-card[data-curated-key]');
  const profileInput = document.getElementById('recipientName');
  const platformsContainer = modalOverlay?.querySelector('.platforms');

  if (!modalOverlay || !modalContent || !closeButton || !modalImg || !modalTitle || !modalDesc || !priceGraph || !resultsArea) {
    return;
  }

  const MODAL_MARKETPLACE_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];
  const MODAL_MARKETPLACE_LABELS = {
    amazon: 'Buy on Amazon',
    flipkart: 'Buy on Flipkart',
    meesho: 'Buy on Meesho',
    myntra: 'Buy on Myntra',
  };

  function normalizeMarketplaceLinks(item) {
    if (!item || typeof item !== 'object') {
      return item;
    }
    if (!item.marketplaceLinks || Object.keys(item.marketplaceLinks).length === 0) {
      const search = encodeURIComponent(item.searchTerm || item.title || 'gift');
      item.marketplaceLinks = {
        amazon: `https://www.amazon.in/s?k=${search}`,
        flipkart: `https://www.flipkart.com/search?q=${search}`,
        meesho: `https://www.meesho.com/search?q=${search}`,
        myntra: `https://www.myntra.com/${search}`,
      };
    }
    return item;
  }

  const isValidModalMarketplaceLink = (platform, link) => {
    if (!link || typeof link !== 'string' || !/^https?:\/\//i.test(link)) {
      return false;
    }
    return Boolean(MARKETPLACE_CONFIG[platform]?.domainPattern?.test(link));
  };

  const renderModalBuyButtons = (item) => {
    if (!platformsContainer) {
      return;
    }

    const links = item?.marketplaceLinks || {};
    const availablePlatforms = [];
    Object.entries(links).forEach(([platform, url]) => {
      if (!url) return;
      if (!MODAL_MARKETPLACE_ORDER.includes(platform)) return;
      if (!isValidModalMarketplaceLink(platform, url)) return;
      availablePlatforms.push(platform);
    });
    availablePlatforms.sort((a, b) => MODAL_MARKETPLACE_ORDER.indexOf(a) - MODAL_MARKETPLACE_ORDER.indexOf(b));
    console.log('[buy-buttons]', item?.title || '', availablePlatforms);

    platformsContainer.innerHTML = '';

    availablePlatforms.forEach((platform) => {
      const a = document.createElement('a');
      a.className = `platform-btn ${platform}`;
      a.href = applyAffiliateToMarketplaceUrl(links[platform], platform);
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = MODAL_MARKETPLACE_LABELS[platform] || `Buy on ${platform}`;
      platformsContainer.appendChild(a);
    });

    platformsContainer.style.display = availablePlatforms.length > 0 ? 'grid' : 'none';
  };

  const openModal = () => {
    modalOverlay.classList.remove('hidden');

    if (reducedMotion) {
      return;
    }

    gsap.killTweensOf([modalOverlay, modalContent]);
    gsap.fromTo(
      modalOverlay,
      { opacity: 0 },
      { opacity: 1, duration: 0.24, ease: 'power1.out' },
    );
    gsap.fromTo(
      modalContent,
      { opacity: 0, y: 30, scale: 0.95, rotateX: -7 },
      { opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 0.55, ease: 'power3.out' },
    );
  };

  const presentItem = (item) => {
    if (!item) {
      return;
    }

    const normalizedItem = item.type ? item : buildRenderableGiftItem(item);
    if (!normalizedItem) {
      return;
    }

    if (normalizedItem.type === 'clarify') {
      profileInput?.focus();
      profileInput?.select();
      return;
    }

    normalizeMarketplaceLinks(normalizedItem);
    ensureModalPrices(normalizedItem);
    console.log('[modal-final-links]', normalizedItem.title, normalizedItem.marketplaceLinks);
    console.log('[FINAL-ITEM]', normalizedItem.title, normalizedItem.type, normalizedItem.marketplacePrices);

    const pricePlatforms = getPricePlatforms(normalizedItem);
    const priceEntries = pricePlatforms.map((entry) => [entry.platform, Number(entry.price)]);
    console.log('[FINAL-DEMO-PRICE]', normalizedItem.title, getPricePlatforms(normalizedItem));
    console.log('[modal-price-raw]', normalizedItem.title, normalizedItem.marketplacePrices);
    console.log('[modal-price-platforms]', normalizedItem.title, getPricePlatforms(normalizedItem));
    const modalDescription = normalizedItem.type === 'concept' && normalizedItem.reasoning
      ? `${normalizedItem.description} ${normalizedItem.reasoning}`
      : normalizedItem.description;

    if (normalizedItem.imageSource === 'locked' || normalizedItem.imageSource === 'demo-local') {
      modalImg.src = resolveAssetPath(normalizedItem.image);
    } else {
      modalImg.src = resolveAssetPath(normalizedItem.image);
    }
    modalImg.alt = normalizedItem.title;
    console.log('[MODAL IMAGE]', normalizedItem.title, normalizedItem.image);
    modalTitle.textContent = normalizedItem.title;
    modalDesc.textContent = modalDescription;

    renderModalBuyButtons(normalizedItem);

    // Price comparison visibility
    if (priceGraphContainer) {
      const hasPrices = priceEntries.length > 0;
      priceGraphContainer.style.display = hasPrices ? 'block' : 'none';
    }

    if (priceEntries.length > 0) {
      const maxPrice = Math.max(...priceEntries.map(([, price]) => price), 1);
      priceGraph.innerHTML = priceEntries
        .map(([platform, price]) => {
          const width = Math.round((price / maxPrice) * 100);
          return `
            <div class="graph-bar-row">
              <div class="bar-label">${MARKETPLACE_CONFIG[platform].label}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width: 0%" data-target="${width}%"></div>
              </div>
              <div class="bar-price">INR ${price.toLocaleString('en-IN')}</div>
            </div>
          `;
        })
        .join('');
    } else {
      priceGraph.innerHTML = '';
    }

    openModal();

    const bars = priceGraph.querySelectorAll('.bar-fill');
    if (reducedMotion) {
      bars.forEach((bar) => {
        bar.style.width = bar.getAttribute('data-target') || '0%';
      });
      return;
    }

    gsap.to(bars, {
      width: (_, element) => element.getAttribute('data-target') || '0%',
      duration: 0.9,
      stagger: 0.08,
      ease: 'power3.out',
    });
  };

  const closeModal = () => {
    if (modalOverlay.classList.contains('hidden')) {
      return;
    }

    if (reducedMotion) {
      modalOverlay.classList.add('hidden');
      return;
    }

    gsap.killTweensOf([modalOverlay, modalContent]);
    gsap.to(modalContent, {
      opacity: 0,
      y: 24,
      scale: 0.97,
      rotateX: -5,
      duration: 0.24,
      ease: 'power2.in',
    });
    gsap.to(modalOverlay, {
      opacity: 0,
      duration: 0.2,
      ease: 'power1.out',
      onComplete: () => {
        modalOverlay.classList.add('hidden');
        gsap.set(modalOverlay, { clearProps: 'opacity' });
        gsap.set(modalContent, { clearProps: 'opacity,transform' });
      },
    });
  };

  closeButton.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });

  resultsArea.addEventListener('click', (event) => {
    const wishBtn = event.target.closest('.result-card__wish');
    if (wishBtn) {
      event.preventDefault();
      event.stopPropagation();
      const wishId = wishBtn.getAttribute('data-wish-id') || '';
      const item = window.currentMockItemsById?.get(wishId);
      if (!item || item.type === 'clarify') {
        return;
      }
      void toggleWishlistForItem(item, wishBtn);
      return;
    }

    const card = event.target.closest('.result-card');

    if (!card || card.classList.contains('result-card--loading') || !window.currentMockItemsById) {
      return;
    }

    const item = card.__giftItem || window.currentMockItemsById.get(card.dataset.productId || '');

    if (item?.type === 'clarify') {
      const questionHint = item.description?.replace(/Would they prefer |\?/g, '') || 'Details';
      const appendText = ` [${questionHint.trim()}?]`;

      if (profileInput) {
        if (!profileInput.value.includes('[')) {
          profileInput.value = `${profileInput.value}${appendText}`;
        }
        profileInput.focus();
        
        // Ensure cursor is at the end of the text
        const length = profileInput.value.length;
        if (profileInput.setSelectionRange) {
          profileInput.setSelectionRange(length - 1, length - 1);
        }
      }
      return;
    }

    presentItem(item);
  });

  collectionCards.forEach((card) => {
    const curatedKey = card.dataset.curatedKey || '';
    const boundItem = CURATED_COLLECTIONS[curatedKey];
    if (boundItem) {
      card.__giftItem = boundItem;
      const previewImg = card.querySelector('.collection-card__image');
      if (previewImg && boundItem.image) {
        previewImg.src = resolveAssetPath(boundItem.image);
        previewImg.alt = boundItem.title || previewImg.alt || 'Curated gift';
      }
      console.log('[CARD IMAGE]', boundItem.title, boundItem.image);
    }

    const openCuratedCollection = () => {
      const item = card.__giftItem || CURATED_COLLECTIONS[card.dataset.curatedKey || ''];
      if (item) {
        console.log('[MODAL IMAGE]', item.title, item.image);
      }
      presentItem(item);
    };

    card.addEventListener('click', openCuratedCollection);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCuratedCollection();
      }
    });
  });
}

function setupCube(stage) {
  const cube = document.querySelector('.cube');

  if (!cube) {
    return;
  }

  if (reducedMotion) {
    cube.style.transform = 'rotateX(-14deg) rotateY(14deg) rotateZ(0deg)';
    return;
  }

  let currentX = -14;
  let currentY = 14;
  let currentZ = 0;
  let spinAngle = 0;
  let lastFrame = performance.now();

  function animateCube(now) {
    const elapsed = Math.min(48, now - lastFrame);
    lastFrame = now;
    spinAngle += elapsed * 0.0116;

    const targetX = -14 + Math.sin(now * 0.00082) * 0.7;
    const targetY = 14 + Math.cos(now * 0.00044) * 0.45;
    const targetZ = Math.sin(now * 0.00068) * 0.2;

    currentX += (targetX - currentX) * 0.055;
    currentY += (targetY - currentY) * 0.055;
    currentZ += (targetZ - currentZ) * 0.055;

    cube.style.transform = `rotateX(${currentX}deg) rotateY(${spinAngle + currentY}deg) rotateZ(${currentZ}deg)`;
    window.requestAnimationFrame(animateCube);
  }

  window.requestAnimationFrame(animateCube);
}
