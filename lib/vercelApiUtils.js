import NodeCache from 'node-cache';
import { getRecommendationsWithFallback } from '../recommendationOrchestrator.js';

const imageCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

const GROQ_MODELS = [
  'llama3-70b-8192',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
];

const GEMINI_ORCHESTRATION_MODELS = GEMINI_MODELS.slice(0, 4);

const IMAGE_TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'gift',
  'idea',
  'minimal',
  'aesthetic',
  'product',
  'photo',
  'official',
]);
const VERIFIED_IMAGE_MIN_SCORE = 18;
const CONCEPT_GOOGLE_MIN_SCORE = 15;
const CONCEPT_UNSPLASH_MIN_SCORE = 9;

function env() {
  return {
    GROQ_API_KEY: process.env.GROQ_API_KEY || '',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    GOOGLE_CSE_KEY: process.env.GOOGLE_CSE_API_KEY || '',
    GOOGLE_CSE_ID: process.env.GOOGLE_CSE_ID || '',
    UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',
  };
}

export function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
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
}

function tokenizeImageText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !IMAGE_TOKEN_STOPWORDS.has(token));
}

function uniqueTokens(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildImageContext(query, rawContext = {}) {
  const title = String(rawContext.title || '').trim();
  const searchTerm = String(rawContext.searchTerm || '').trim();
  const category = String(rawContext.category || '').trim();
  const recipientRole = String(rawContext.recipientRole || '').trim();
  const interestTags = Array.isArray(rawContext.interestTags) ? rawContext.interestTags : [];

  return {
    query: String(query || '').trim(),
    title,
    searchTerm,
    category,
    recipientRole,
    interestTags,
    titleTokens: tokenizeImageText(title),
    searchTokens: tokenizeImageText(searchTerm),
    categoryTokens: tokenizeImageText(category),
    contextTokens: uniqueTokens([
      ...tokenizeImageText(recipientRole),
      ...interestTags.flatMap((tag) => tokenizeImageText(tag)),
    ]),
  };
}

function scoreTokenMatches(text, tokens, weight) {
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += weight;
  }
  return score;
}

function hasPrimaryImageMatch(context, metadata) {
  return [...context.titleTokens, ...context.searchTokens].some((token) => metadata.includes(token));
}

function isTitleSpecificEnough(context) {
  const strongTokens = uniqueTokens([...context.titleTokens, ...context.searchTokens]).filter((token) => ![
    'gift', 'idea', 'premium', 'classic', 'luxury',
  ].includes(token));
  return strongTokens.length >= 2;
}

function scoreGoogleImageResult(item, context) {
  const metadata = [item?.title, item?.snippet, item?.displayLink, item?.image?.contextLink]
    .join(' ')
    .toLowerCase();
  const link = String(item?.link || '').toLowerCase();
  let score = 0;

  score += scoreTokenMatches(metadata, context.titleTokens, 6);
  score += scoreTokenMatches(metadata, context.searchTokens, 5);
  score += scoreTokenMatches(metadata, context.categoryTokens, 3);
  score += scoreTokenMatches(metadata, context.contextTokens, 2);

  if (context.title && metadata.includes(context.title.toLowerCase())) score += 8;
  if (context.searchTerm && metadata.includes(context.searchTerm.toLowerCase())) score += 8;
  if (context.category && metadata.includes(context.category.toLowerCase())) score += 4;
  if (/amazon|flipkart|myntra|meesho|brand|store|shop|product|official/.test(metadata)) score += 3;
  if (/logo|icon|clipart|vector|pngtree|transparent|wallpaper|banner|template|mockup/.test(`${metadata} ${link}`)) score -= 10;
  if (/\.(svg|gif)(?:\?|$)/i.test(link)) score -= 8;
  if (!hasPrimaryImageMatch(context, metadata)) score -= 8;

  return score;
}

function scoreUnsplashResult(photo, context) {
  const metadata = [
    photo?.alt_description,
    photo?.description,
    photo?.slug,
    ...(Array.isArray(photo?.tags) ? photo.tags.map((tag) => tag?.title) : []),
  ].join(' ').toLowerCase();
  let score = 0;

  score += scoreTokenMatches(metadata, context.titleTokens, 5);
  score += scoreTokenMatches(metadata, context.searchTokens, 4);
  score += scoreTokenMatches(metadata, context.categoryTokens, 3);
  score += scoreTokenMatches(metadata, context.contextTokens, 2);

  if (context.title && metadata.includes(context.title.toLowerCase())) score += 6;
  if (context.searchTerm && metadata.includes(context.searchTerm.toLowerCase())) score += 6;
  if (/abstract|background|pattern|texture|wallpaper|3d render|gradient/.test(metadata) && !hasPrimaryImageMatch(context, metadata)) score -= 7;
  if (!hasPrimaryImageMatch(context, metadata)) score -= 5;
  return score;
}

async function googleImageBestResult(query, context, minScore) {
  const { GOOGLE_CSE_KEY, GOOGLE_CSE_ID } = env();
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_ID) return null;

  const q = encodeURIComponent(query.trim().slice(0, 200));
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_CSE_KEY)}&cx=${encodeURIComponent(GOOGLE_CSE_ID)}&searchType=image&num=6&safe=active&q=${q}`;
  const data = await fetchJson(url);
  const items = data?.items;
  if (!Array.isArray(items) || !items.length) return null;

  const best = items
    .map((item) => ({ item, score: scoreGoogleImageResult(item, context) }))
    .filter(({ item }) => typeof item?.link === 'string' && /^https?:\/\//i.test(item.link))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < minScore) return null;
  return {
    url: best.item.link,
    score: best.score,
    displayLink: best.item?.displayLink || '',
    contextLink: best.item?.image?.contextLink || '',
    title: best.item?.title || '',
    snippet: best.item?.snippet || '',
  };
}

async function unsplashImageBestResult(query, context, minScore) {
  const { UNSPLASH_ACCESS_KEY } = env();
  if (!UNSPLASH_ACCESS_KEY) return null;

  const q = encodeURIComponent(query.trim().slice(0, 120));
  const url = `https://api.unsplash.com/search/photos?per_page=6&orientation=squarish&query=${q}`;
  const data = await fetchJson(url, {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length || !isTitleSpecificEnough(context)) return null;

  const best = results
    .map((photo) => ({ photo, score: scoreUnsplashResult(photo, context) }))
    .filter(({ photo }) => typeof photo?.urls?.regular === 'string' || typeof photo?.urls?.small === 'string')
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < minScore) return null;
  return {
    url: best.photo?.urls?.regular || best.photo?.urls?.small || null,
    score: best.score,
    altDescription: best.photo?.alt_description || '',
    description: best.photo?.description || '',
  };
}

export async function handleHealth(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  const { GROQ_API_KEY, GEMINI_API_KEY, GOOGLE_CSE_KEY, GOOGLE_CSE_ID, UNSPLASH_ACCESS_KEY } = env();
  return sendJson(res, 200, {
    ok: true,
    groq: Boolean(GROQ_API_KEY),
    gemini: Boolean(GEMINI_API_KEY),
    googleCse: Boolean(GOOGLE_CSE_KEY && GOOGLE_CSE_ID),
    unsplash: Boolean(UNSPLASH_ACCESS_KEY),
  });
}

export async function handleGeminiGenerate(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  const { prompt, context, candidates, generationConfig } = body || {};
  const hasLegacyPrompt = typeof prompt === 'string' && prompt.trim();
  const hasStructuredRequest = context && typeof context === 'object' && Array.isArray(candidates);

  if (!hasLegacyPrompt && !hasStructuredRequest) {
    return sendJson(res, 400, {
      error: 'Body must include either a structured { context, candidates } payload or a non-empty "prompt" string',
    });
  }

  const { GROQ_API_KEY, GEMINI_API_KEY } = env();
  const config = {
    temperature: 0.1,
    responseMimeType: 'application/json',
    ...(generationConfig && typeof generationConfig === 'object' ? generationConfig : {}),
  };

  try {
    const result = await getRecommendationsWithFallback({
      prompt,
      context,
      candidates,
      generationConfig: config,
      groqApiKey: GROQ_API_KEY,
      groqModels: GROQ_MODELS,
      geminiApiKey: GEMINI_API_KEY,
      models: GEMINI_ORCHESTRATION_MODELS,
      log: (msg, detail) => {
        if (detail !== undefined) {
          console.log('[giftai-api]', msg, detail);
        } else {
          console.log('[giftai-api]', msg);
        }
      },
    });

    return sendJson(res, 200, {
      source: result.source,
      items: Array.isArray(result.items) ? result.items : [],
      model: result.model || null,
      usedFallback: Boolean(result.usedFallback),
      reason: result.reason || null,
    });
  } catch (e) {
    const message = e?.message || String(e);
    console.error('[giftai-api] orchestrator error', message);
    return sendJson(res, 502, { error: 'Recommendation pipeline failed', detail: message });
  }
}

export async function handleImageResolve(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const mode = String(req.query.mode || 'concept').toLowerCase();
  const rawQuery = String(req.query.q || '').replace(/\s+/g, ' ').trim();
  const encodedQuery = encodeURIComponent(rawQuery.slice(0, 100));
  const query = decodeURIComponent(encodedQuery);
  const categoryText = String(req.query.category || '').toLowerCase();

  const fallbackImage = /\b(teacher|stationery|planner|pen|book|lamp)\b/.test(`${query.toLowerCase()} ${categoryText}`)
    ? '/minimal_desk.png'
    : /\b(math|puzzle|logic|geometry|rubik)\b/.test(`${query.toLowerCase()} ${categoryText}`)
      ? '/zen_garden.png'
      : /\b(coffee|mug|espresso|grinder)\b/.test(`${query.toLowerCase()} ${categoryText}`)
        ? '/modern_coffee_mug.png'
        : /\b(home|candle|decor|plant|fragrance)\b/.test(`${query.toLowerCase()} ${categoryText}`)
          ? '/candle_mock.png'
          : /\b(tech|gaming|headset|keyboard|mouse|controller)\b/.test(`${query.toLowerCase()} ${categoryText}`)
            ? '/headphones_mock.png'
            : /\b(travel|wallet|passport|luggage)\b/.test(`${query.toLowerCase()} ${categoryText}`)
              ? '/sleek_wallet.png'
              : '/minimal_desk.png';

  if (!query || query.length < 3) {
    return sendJson(res, 200, {
      ok: false,
      image: fallbackImage,
      reason: 'provider_error',
      primaryUrl: null,
      googleUrl: null,
      unsplashUrl: null,
      source: null,
      sourceConfidence: null,
      sourceMetadata: null,
    });
  }

  const context = buildImageContext(query, {
    title: req.query.title,
    searchTerm: req.query.searchTerm,
    category: req.query.category,
    recipientRole: req.query.recipientRole,
    interestTags: String(req.query.interestTags || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4),
  });

  const cacheKey = `${mode}|${query}|${context.title}|${context.searchTerm}|${context.category}|${context.recipientRole}|${context.interestTags.join(',')}`;
  const hit = imageCache.get(cacheKey);
  if (hit) return sendJson(res, 200, hit);

  try {
    if (mode === 'product') {
      const google = await googleImageBestResult(query, context, VERIFIED_IMAGE_MIN_SCORE);
      const googleUrl = google?.url || null;
      const payload = {
        primaryUrl: googleUrl,
        googleUrl,
        unsplashUrl: null,
        source: googleUrl ? 'google' : null,
        sourceConfidence: google?.score ?? null,
        sourceMetadata: googleUrl
          ? {
            displayLink: google.displayLink,
            contextLink: google.contextLink,
            title: google.title,
            snippet: google.snippet,
          }
          : null,
      };
      imageCache.set(cacheKey, payload);
      return sendJson(res, 200, payload);
    }

    if (mode === 'mixed' || mode === 'concept') {
      const [google, unsplashImage] = await Promise.all([
        googleImageBestResult(query, context, CONCEPT_GOOGLE_MIN_SCORE).catch(() => null),
        unsplashImageBestResult(query, context, CONCEPT_UNSPLASH_MIN_SCORE).catch(() => null),
      ]);
      const googleUrl = google?.url || null;
      const unsplashResolvedUrl = unsplashImage?.url || null;
      const selected = google || unsplashImage || null;
      const payload = {
        googleUrl,
        unsplashUrl: unsplashResolvedUrl,
        primaryUrl: selected?.url || null,
        source: googleUrl ? 'google' : unsplashResolvedUrl ? 'unsplash' : null,
        sourceConfidence: selected?.score ?? null,
        sourceMetadata: googleUrl
          ? {
            displayLink: google.displayLink,
            contextLink: google.contextLink,
            title: google.title,
            snippet: google.snippet,
          }
          : unsplashResolvedUrl
            ? {
              altDescription: unsplashImage.altDescription,
              description: unsplashImage.description,
            }
            : null,
      };
      imageCache.set(cacheKey, payload);
      return sendJson(res, 200, payload);
    }

    return sendJson(res, 200, {
      ok: false,
      image: fallbackImage,
      reason: 'provider_error',
      primaryUrl: null,
      googleUrl: null,
      unsplashUrl: null,
      source: null,
      sourceConfidence: null,
      sourceMetadata: null,
    });
  } catch {
    return sendJson(res, 200, {
      ok: false,
      image: fallbackImage,
      reason: 'provider_error',
      primaryUrl: null,
      googleUrl: null,
      unsplashUrl: null,
      source: null,
      sourceConfidence: null,
      sourceMetadata: null,
    });
  }
}
