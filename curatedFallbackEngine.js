/**
 * Demo-stable curated fallback engine.
 * Strong deterministic recommendations when AI providers are unavailable.
 */

const IMAGE_BY_CATEGORY = {
  teacher: ['/minimal_desk.png', '/desk_mat_mock.png'],
  math: ['/desk_mat_mock.png', '/minimal_desk.png'],
  gamer: ['/headphones_mock.png', '/desk_mat_mock.png'],
  cooking: ['/zen_garden.png', '/minimal_desk.png'],
  coffee: ['/modern_coffee_mug.png', '/minimal_desk.png'],
  traveler: ['/sleek_wallet.png', '/luxury_watch.png'],
  reader: ['/minimal_desk.png', '/desk_mat_mock.png'],
  artist: ['/zen_garden.png', '/minimal_desk.png'],
  fitness: ['/smart_ring_mock.png', '/headphones_mock.png'],
  music: ['/headphones_mock.png', '/desk_mat_mock.png'],
  tech: ['/desk_mat_mock.png', '/headphones_mock.png'],
  universal: ['/candle_mock.png', '/matte_watch.png', '/minimal_desk.png'],
};

const CATEGORY_ITEMS = {
  teacher: [
    'Premium Pen Set',
    'Wooden Desk Organizer',
    'Academic Planner',
    'Adjustable Reading Lamp',
    'Personalized Appreciation Mug',
    'Classic Book Collection',
  ],
  math: [
    'Mechanical Logic Puzzle',
    'Math Puzzle Book',
    "Rubik\'s Cube Set",
    'Geometry Desk Sculpture',
    'Strategy Board Game',
    'Scientific Calculator Stand',
  ],
  gamer: [
    'Gaming Headset',
    'RGB Keyboard',
    'Gaming Mouse',
    'Gaming Desk Mat',
    'Controller Stand',
    'LED Room Light',
  ],
  cooking: [
    'Spice Box Set',
    'Recipe Journal',
    'Kitchen Organizer',
    'Premium Cookware Tool',
    'Baking Kit',
    'Herb Garden Kit',
  ],
  coffee: [
    'Smart Mug',
    'Pour Over Coffee Kit',
    'Coffee Subscription',
    'French Press',
    'Coffee Grinder',
    'Ceramic Mug Set',
  ],
  traveler: [
    'Travel Organizer',
    'Neck Pillow',
    'Passport Wallet',
    'Power Bank',
    'Packing Cubes',
    'Travel Bottle Set',
  ],
  reader: [
    'Reading Lamp',
    'Kindle Sleeve',
    'Premium Bookmark Set',
    'Book Stand',
    'Personal Library Stamp',
    'Notebook Journal',
  ],
  artist: [
    'Sketchbook Set',
    'Brush Pen Set',
    'Mini Easel',
    'Art Supply Organizer',
    'Digital Drawing Glove',
    'Color Palette Notebook',
  ],
  fitness: [
    'Smart Water Bottle',
    'Resistance Bands',
    'Gym Duffel Bag',
    'Yoga Mat',
    'Fitness Journal',
    'Foam Roller',
  ],
  music: [
    'Bluetooth Speaker',
    'Headphone Stand',
    'Vinyl Record Display',
    'Music Notebook',
    'Portable Earbuds Case',
    'Desk Speaker',
  ],
  tech: [
    'Mechanical Keyboard',
    'Laptop Stand',
    'Desk Mat',
    'Cable Organizer',
    'Blue Light Glasses',
    'USB Hub',
  ],
  universal: [
    'Scented Candle Set',
    'Classic Leather Wallet',
    'Wireless Headphones',
    'Minimalist Watch',
    'Elegant Perfume',
    'Indoor Plant Kit',
  ],
};

const CATEGORY_META = {
  teacher: { category: 'Teacher Appreciation', tags: ['teacher', 'mentor', 'professor', 'sir'], keywords: ['teacher', 'sir', 'mentor', 'professor', 'educator'] },
  math: { category: 'Math & Logic', tags: ['math', 'logic', 'study', 'nerd'], keywords: ['math', 'logic', 'study', 'nerd', 'algebra', 'puzzle'] },
  gamer: { category: 'Gaming', tags: ['gamer', 'gaming', 'younger brother'], keywords: ['gamer', 'gaming', 'younger brother', 'brother', 'console'] },
  cooking: { category: 'Cooking & Kitchen', tags: ['cooking', 'mother', 'kitchen lover'], keywords: ['cooking', 'cook', 'kitchen', 'mother', 'mom'] },
  coffee: { category: 'Coffee Gear', tags: ['coffee lover'], keywords: ['coffee', 'espresso', 'caffeine', 'mug'] },
  traveler: { category: 'Travel', tags: ['traveler'], keywords: ['travel', 'traveler', 'trip', 'vacation'] },
  reader: { category: 'Reading', tags: ['reader', 'book lover'], keywords: ['reader', 'reading', 'book', 'book lover', 'kindle'] },
  artist: { category: 'Art & Creative', tags: ['artist', 'creative person'], keywords: ['artist', 'creative', 'drawing', 'art'] },
  fitness: { category: 'Fitness', tags: ['fitness lover'], keywords: ['fitness', 'gym', 'workout', 'yoga'] },
  music: { category: 'Music', tags: ['music lover'], keywords: ['music', 'audio', 'song', 'speaker'] },
  tech: { category: 'Tech & Coding', tags: ['tech', 'coder', 'developer'], keywords: ['tech', 'coder', 'developer', 'programmer', 'keyboard', 'laptop'] },
  universal: { category: 'Universal Gifts', tags: ['all occasion', 'universal gifts'], keywords: ['all occasion', 'universal', 'anyone', 'gift'] },
};

const CATEGORY_ORDER = ['teacher', 'math', 'gamer', 'cooking', 'coffee', 'traveler', 'reader', 'artist', 'fitness', 'music', 'tech', 'universal'];

function extractIntent(inputText) {
  const text = String(inputText || '').toLowerCase();
  let role = 'friend';
  if (/\b(teacher|teaching|school|sir|ma'?am|professor|mentor)\b/.test(text)) role = 'teacher';
  else if (/\b(mother|mom|mum)\b/.test(text)) role = 'mother';
  else if (/\b(friend|buddy)\b/.test(text)) role = 'friend';

  const interests = [];
  if (/\b(math|puzzle|logic|numbers|algebra|geometry|rubik)\b/.test(text)) interests.push('math');
  if (/\b(kitchen|cooking|chef|cookware|spice)\b/.test(text)) interests.push('cooking');
  if (/\b(game|gaming|setup|rgb|fps|controller)\b/.test(text)) interests.push('gaming');
  if (/\b(coffee|mug|espresso|grinder)\b/.test(text)) interests.push('coffee');
  if (!interests.length) interests.push('general');

  let occasion = 'birthday';
  if (/\b(anniversary)\b/.test(text)) occasion = 'anniversary';
  else if (/\b(wedding)\b/.test(text)) occasion = 'wedding';
  else if (/\b(housewarming)\b/.test(text)) occasion = 'housewarming';

  let budgetRange = 'low';
  if (/\b(10000\+|above 10000|over 10000|10k)\b/.test(text)) budgetRange = 'high';
  else if (/\b(2000\s*[-to]+\s*10000|between 2000 and 10000)\b/.test(text)) budgetRange = 'mid';

  return { role, interests, occasion, budgetRange };
}

function selectedCategoriesFromIntent(intent, rawText) {
  const text = String(rawText || '').toLowerCase();
  const categories = [];
  if (intent.role === 'teacher') categories.push('teacher');
  if (intent.role === 'mother' || intent.interests.includes('cooking')) categories.push('cooking');
  if (intent.interests.includes('math')) categories.push('math');
  if (intent.interests.includes('gaming')) categories.push('gamer');
  if (intent.interests.includes('coffee')) categories.push('coffee');
  if (!categories.length || intent.interests.includes('general')) categories.push('universal');

  // Strict rule: no desk-mat/keyboard/gaming unless explicitly requested
  if (!/\b(study|desk|office|coding|gaming|workspace|setup|rgb|fps)\b/.test(text)) {
    return categories.filter((c) => c !== 'gamer' && c !== 'tech');
  }
  return categories;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function parseBudgetBand(ctx) {
  const text = [ctx.rawProfile, ctx.selectedOccasionLabel, ctx.priceSensitivity].join(' ').toLowerCase();
  if (/under\s*2000|below\s*2000|less than\s*2000/.test(text)) return 'under_2000';
  if (/2000\s*[-to]+\s*10000|between\s*2000\s*and\s*10000/.test(text)) return '2000_10000';
  if (/10\s*k|10000\+|above\s*10000|over\s*10000/.test(text)) return '10000_plus';
  const numeric = text.match(/\b(\d{3,6})\b/g) || [];
  const nums = numeric.map((n) => Number.parseInt(n, 10)).filter(Number.isFinite);
  const max = nums.length ? Math.max(...nums) : 0;
  if (max > 10000) return '10000_plus';
  if (max >= 2000) return '2000_10000';
  return 'under_2000';
}

function priceRangeByBand(band) {
  if (band === '10000_plus') {
    return {
      amazon: [11999, 29999],
      flipkart: [10999, 28999],
      meesho: [8999, 19999],
      myntra: [12999, 34999],
    };
  }
  if (band === '2000_10000') {
    return {
      amazon: [2499, 8999],
      flipkart: [2399, 8799],
      meesho: [1999, 6999],
      myntra: [2799, 9999],
    };
  }
  return {
    amazon: [799, 1799],
    flipkart: [749, 1699],
    meesho: [499, 1499],
    myntra: [899, 1999],
  };
}

function deterministicPrice(title, platform, band) {
  const [min, max] = priceRangeByBand(band)[platform];
  const span = max - min;
  const seed = hashString(`${platform}|${title}|${band}`);
  return min + (seed % (span + 1));
}

function buildMarketplaceLinks(title) {
  const encoded = encodeURIComponent(title);
  return {
    amazon: `https://www.amazon.in/s?k=${encoded}`,
    flipkart: `https://www.flipkart.com/search?q=${encoded}`,
    meesho: `https://www.meesho.com/search?q=${encoded}`,
    myntra: `https://www.myntra.com/${encoded}`,
  };
}

function pickImage(category, idx) {
  const pool = IMAGE_BY_CATEGORY[category] || IMAGE_BY_CATEGORY.universal;
  return pool[idx % pool.length];
}

function scoreCategory(ctx, key) {
  const meta = CATEGORY_META[key];
  const text = [
    ctx.rawProfile,
    ctx.recipientType,
    ctx.selectedOccasionLabel,
    ...(Array.isArray(ctx.interestTags) ? ctx.interestTags : []),
    ...(Array.isArray(ctx.intentTags) ? ctx.intentTags : []),
    ...(Array.isArray(ctx.extractedInterests) ? ctx.extractedInterests : []),
    ctx.extractedRecipientRole,
  ].join(' ').toLowerCase();

  let score = 0;

  // Priority 1: explicit recipient role
  if (ctx.extractedRecipientRole && meta.tags.includes(ctx.extractedRecipientRole)) score += 120;
  if (ctx.recipientType && meta.tags.includes(ctx.recipientType)) score += 90;

  // Priority 2: explicit interests
  const explicitInterests = Array.isArray(ctx.extractedInterests) ? ctx.extractedInterests : [];
  if (explicitInterests.includes(key)) score += 70;
  for (const keyword of meta.keywords) {
    if (text.includes(keyword)) score += 9;
  }

  // Priority 3: occasion
  if (/birthday|anniversary|wedding|festival/.test(text) && key === 'universal') score += 8;

  // Priority 4: budget suitability
  const band = parseBudgetBand(ctx);
  if (band === 'under_2000' && ['teacher', 'math', 'cooking', 'universal'].includes(key)) score += 6;
  if (band === '2000_10000' && ['tech', 'gamer', 'music', 'traveler'].includes(key)) score += 6;

  // Guardrail: avoid desk/workspace-heavy categories unless explicitly requested
  if (['tech', 'gamer'].includes(key) && !/\b(study|desk|office|coding|gaming|workspace)\b/.test(text)) {
    score -= 60;
  }
  return score;
}

function matchCategory(ctx) {
  const ranked = CATEGORY_ORDER
    .map((key) => ({ key, score: scoreCategory(ctx, key) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].key : 'universal';
}

function makeItem(categoryKey, title, idx, budgetBand) {
  const meta = CATEGORY_META[categoryKey];
  const id = `${slug(categoryKey)}-${slug(title)}`;
  return {
    id,
    title,
    description: `Practical ${title.toLowerCase()} tailored for ${meta.category.toLowerCase()} gifting.`,
    category: meta.category,
    type: 'verified',
    validationStatus: 'verified',
    image: pickImage(categoryKey, idx),
    marketplaceLinks: buildMarketplaceLinks(title),
    marketplacePrices: {
      amazon: deterministicPrice(title, 'amazon', budgetBand),
      flipkart: deterministicPrice(title, 'flipkart', budgetBand),
      meesho: deterministicPrice(title, 'meesho', budgetBand),
      myntra: deterministicPrice(title, 'myntra', budgetBand),
    },
    searchTerm: title,
    reason: `Matched ${meta.category.toLowerCase()} from recipient/interest/occasion context.`,
    brand: '',
    recipientTags: [categoryKey],
    interestTags: meta.tags,
    styleTags: ['practical', 'demo-stable'],
    occasionTags: ['birthday', 'all occasion'],
    confidenceScore: 0.9,
  };
}

export const FALLBACK_POOL = CATEGORY_ORDER.flatMap((categoryKey) =>
  CATEGORY_ITEMS[categoryKey].map((title, idx) => makeItem(categoryKey, title, idx, 'under_2000')),
);

export function buildCuratedFallbackRecommendations(ctx, catalogById, { limit = 6 } = {}) {
  const intent = extractIntent(ctx.rawProfile || '');
  console.log('[INTENT]', intent);
  const selectedCategories = selectedCategoriesFromIntent(intent, ctx.rawProfile || '');
  if (!selectedCategories.length) selectedCategories.push(matchCategory(ctx));
  console.log('[CATEGORY]', selectedCategories);
  console.log('[accuracy-category]', intent.role, intent.interests, selectedCategories[0] || 'universal');
  console.log(`[demo-fallback] matched category: ${selectedCategories[0] || 'universal'}`);

  const budgetBand = parseBudgetBand(ctx);
  const pool = selectedCategories.flatMap((categoryKey) => {
    const titles = CATEGORY_ITEMS[categoryKey] || [];
    return titles.map((title, idx) => makeItem(categoryKey, title, idx, budgetBand));
  });

  // Diversity: avoid repetitive type words and duplicate titles
  const typeSeen = new Set();
  const deduped = [];
  for (const item of pool) {
    const kind = item.title.toLowerCase()
      .replace(/\b(premium|classic|set|kit)\b/g, '')
      .trim()
      .split(' ')
      .slice(-1)[0];
    if (typeSeen.has(kind) || deduped.some((x) => x.title.toLowerCase() === item.title.toLowerCase())) continue;
    typeSeen.add(kind);
    deduped.push(item);
    if (deduped.length >= Math.max(8, limit)) break;
  }
  const items = deduped;

  const allowedIds = new Set((catalogById && typeof catalogById.keys === 'function') ? catalogById.keys() : []);
  const filtered = allowedIds.size > 0 ? items.filter((item) => allowedIds.has(item.id)) : items;
  const base = filtered.length >= 5 ? filtered : items;
  const output = base.slice(0, Math.max(5, Math.min(8, limit)));
  console.log('[FINAL ITEMS]', output.map((i) => i.title));
  return output;
}
