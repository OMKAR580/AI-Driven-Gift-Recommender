/**
 * Marketplace Search Link Generator
 * Generates deterministic marketplace search URLs for all recommendation items.
 * Always returns links for amazon, flipkart, meesho, and myntra.
 */

const MARKETPLACE_CONFIG = {
  amazon: {
    baseUrl: 'https://www.amazon.in/s',
    queryParam: 'k',
    label: 'Amazon',
  },
  flipkart: {
    baseUrl: 'https://www.flipkart.com/search',
    queryParam: 'q',
    label: 'Flipkart',
  },
  myntra: {
    baseUrl: 'https://www.myntra.com',
    encodeQuery: true, // myntra uses path-based query
    label: 'Myntra',
  },
  meesho: {
    baseUrl: 'https://www.meesho.com/search',
    queryParam: 'q',
    label: 'Meesho',
  },
};

const MARKETPLACE_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];

function normalizeExistingLinks(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((acc, [platform, url]) => {
    const key = String(platform || '').trim().toLowerCase();
    if (MARKETPLACE_CONFIG[key] && typeof url === 'string' && /^https?:\/\//i.test(url.trim())) {
      acc[key] = url.trim();
    }
    return acc;
  }, {});
}

/**
 * Generate a single marketplace search URL
 */
function generateSearchUrl(platform, query) {
  if (!query || !MARKETPLACE_CONFIG[platform]) {
    return null;
  }

  const config = MARKETPLACE_CONFIG[platform];
  const encoded = encodeURIComponent(query.trim());

  if (platform === 'myntra') {
    // Myntra uses path-based encoding: /query-with-dashes
    const pathQuery = encoded.replace(/%20/g, '-').toLowerCase();
    return `${config.baseUrl}/${pathQuery}`;
  }

  // Standard query param approach: ?q=query or ?k=query
  const url = new URL(config.baseUrl);
  url.searchParams.set(config.queryParam, query.trim());
  return url.toString();
}

/**
 * Generate marketplace search links for any item.
 * Returns object: { amazon, flipkart, meesho, myntra }
 */
export function generateMarketplaceSearchLinks(item) {
  const query = String(item?.searchTerm || item?.title || '').trim();
  if (!query || query.length < 2) {
    return {};
  }

  const links = {};

  for (const platform of MARKETPLACE_ORDER) {
    const url = generateSearchUrl(platform, query);
    if (url) {
      links[platform] = url;
    }
  }

  return links;
}

/**
 * Enhance marketplace links: keep existing catalog links,
 * generate search links only if missing
 */
export function enhanceMarketplaceLinks(item) {
  if (!item) return {};

  const existing = normalizeExistingLinks(item.marketplaceLinks);
  const generated = generateMarketplaceSearchLinks(item);

  // Existing catalog links win; search links fill only the missing honest buttons.
  return {
    ...generated,
    ...existing,
  };
}
