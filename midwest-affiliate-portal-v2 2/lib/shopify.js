// Shopify: client-credentials auth (auto-refreshing token) + utm_source attribution.
const SHOP = process.env.SHOP;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

let _token = null;
let _tokenExp = 0;

async function token() {
  if (_token && Date.now() < _tokenExp) return _token;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Shopify auth failed: ${res.status} ${await res.text()}`);
  const d = await res.json();
  _token = d.access_token;
  _tokenExp = Date.now() + Math.max(0, (d.expires_in || 86400) - 300) * 1000;
  return _token;
}

function utmSourceOf(landingSite) {
  if (!landingSite) return null;
  const qs = landingSite.split('?')[1];
  if (!qs) return null;
  const s = new URLSearchParams(qs).get('utm_source');
  return s ? s.trim().toLowerCase() : null;
}

// Cache attribution briefly so a page load with several affiliates isn't N full scans.
let _attrCache = null;
let _attrExp = 0;
const ATTR_TTL_MS = 60 * 1000;

// { [tag]: { orders, sales } } across all paid orders.
export async function attributionMap() {
  if (_attrCache && Date.now() < _attrExp) return _attrCache;
  const t = await token();
  const map = {};
  let url = `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/orders.json` +
            `?status=any&financial_status=paid&limit=250&fields=id,total_price,landing_site`;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': t } });
    if (!res.ok) throw new Error(`Shopify orders failed: ${res.status} ${await res.text()}`);
    const { orders } = await res.json();
    for (const o of orders) {
      const src = utmSourceOf(o.landing_site);
      if (!src) continue;
      (map[src] ||= { orders: 0, sales: 0 });
      map[src].orders += 1;
      map[src].sales += parseFloat(o.total_price || '0');
    }
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  _attrCache = map;
  _attrExp = Date.now() + ATTR_TTL_MS;
  return map;
}

export async function salesForTag(tag) {
  const map = await attributionMap();
  const row = map[String(tag).toLowerCase()] || { orders: 0, sales: 0 };
  return { orders: row.orders, sales: Math.round(row.sales * 100) / 100 };
}
