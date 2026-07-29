// MidWest Tees — Affiliate Portal v2
// Scoped AI helper + live Shopify commissions + Supabase roster/payouts + owner dashboard.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { salesForTag } from './lib/shopify.js';
import * as store from './lib/db.js';
import { askHelper } from './lib/ai.js';
import { flyerCopy, flyerImage } from './lib/flyer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_URL = process.env.STORE_URL || 'https://shopmidwesttees.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const productLinkFor = (tag, handle) =>
  handle ? `${STORE_URL}/products/${handle}?utm_source=${encodeURIComponent(tag)}`
         : `${STORE_URL}/?utm_source=${encodeURIComponent(tag)}`;

const round2 = n => Math.round(n * 100) / 100;
const linkFor = tag => `${STORE_URL}/?utm_source=${tag}`;

// Live stats for one affiliate: Shopify sales + Supabase payouts.
async function computeStats(aff) {
  const { orders, sales } = await salesForTag(aff.tag);
  const rate = parseFloat(aff.commission_rate ?? 0.10);
  const earned = round2(sales * rate);
  const paid = round2(await store.paidTotal(aff.id));
  const owed = round2(earned - paid);
  return {
    id: aff.id, name: aff.name, tag: aff.tag, venmo: aff.venmo,
    link: linkFor(aff.tag), rate, orders, sales, earned, paid, owed,
  };
}

function welcomeMessage(aff) {
  return (
`Hey ${aff.name}! 🎉 You're officially a MidWest Tees affiliate.

Here's your personal link — share it anywhere:
${linkFor(aff.tag)}

When someone clicks it and buys, you earn ${Math.round((aff.commission_rate ?? 0.10) * 100)}% of their order. We send your money by Venmo.

Check your earnings & ask questions anytime at your private portal:
{{PORTAL_URL}}/?token=${aff.token}

Just start sharing — you can't mess it up. 💛`
  );
}

/* ------------------------- auth middleware ------------------------- */
async function affiliateAuth(req, res, next) {
  const token = req.query.token || req.body?.token || req.headers['x-portal-token'];
  const aff = await store.getAffiliateByToken(token);
  if (!aff) return res.status(401).json({ error: 'Invalid or missing portal link.' });
  req.aff = aff;
  next();
}
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Admin password required.' });
  next();
}

/* ------------------------- affiliate API --------------------------- */
app.get('/api/me', affiliateAuth, async (req, res) => {
  try { res.json(await computeStats(req.aff)); }
  catch (e) { console.error(e); res.status(502).json({ error: 'Could not load your numbers right now.' }); }
});

app.post('/api/ask', affiliateAuth, async (req, res) => {
  const question = (req.body?.question || '').toString().slice(0, 1000).trim();
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  if (!question) return res.status(400).json({ error: 'Ask me a question!' });
  try {
    const stats = await computeStats(req.aff);
    const answer = await askHelper(stats, question, history);
    store.logChat({ affiliateId: req.aff.id, question, answer });
    res.json({ answer });
  } catch (e) { console.error(e); res.status(502).json({ error: 'My brain is napping — try again in a sec.' }); }
});

// AI flyer: Claude writes the copy, Google paints a text-free background image.
app.post('/api/flyer-ai', affiliateAuth, async (req, res) => {
  const theme = (req.body?.theme || '').toString().slice(0, 300).trim();
  const products = Array.isArray(req.body?.products) ? req.body.products.slice(0, 3) : [];
  try {
    const [copy, img] = await Promise.all([ flyerCopy(theme, products), flyerImage(theme, products) ]);
    res.json({
      headline: copy.headline,
      subhead: copy.subhead,
      image: img.image,
      imageError: img.error || null,
    });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Could not make a flyer right now — try again.' }); }
});

// Save a finished flyer image, and list / delete an affiliate's saved flyers.
app.post('/api/flyer/save', affiliateAuth, async (req, res) => {
  const image = (req.body?.image || '').toString();
  const headline = (req.body?.headline || '').toString();
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) return res.status(400).json({ error: 'No flyer image to save.' });
  try {
    const imageUrl = await store.uploadPostImage(image, 'flyer');
    const flyer = await store.saveFlyer({ affiliateId: req.aff.id, headline, imageUrl });
    res.json({ flyer });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not save the flyer.' }); }
});

app.get('/api/flyer/list', affiliateAuth, async (req, res) => {
  try { res.json({ flyers: await store.listFlyers(req.aff.id) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not load your flyers.' }); }
});

app.delete('/api/flyer/:id', affiliateAuth, async (req, res) => {
  try { await store.deleteFlyer(req.params.id, req.aff.id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not delete the flyer.' }); }
});

/* --------------------------- admin API ----------------------------- */
app.get('/api/admin/affiliates', adminAuth, async (_req, res) => {
  try {
    const list = await store.listAffiliates();
    const rows = await Promise.all(list.map(async a => {
      try { return { ...(await computeStats(a)), status: a.status, email: a.email, token: a.token }; }
      catch { return { id: a.id, name: a.name, tag: a.tag, link: linkFor(a.tag), error: true }; }
    }));
    const totalOwed = round2(rows.reduce((s, r) => s + (r.owed || 0), 0));
    res.json({ affiliates: rows, totalOwed });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not load affiliates.' }); }
});

app.post('/api/admin/affiliates', adminAuth, async (req, res) => {
  const { name, email, venmo, rate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    const aff = await store.createAffiliate({ name, email, venmo, rate: rate != null ? parseFloat(rate) : 0.10 });
    res.json({
      affiliate: { ...aff, link: linkFor(aff.tag) },
      portalPath: `/?token=${aff.token}`,
      welcome: welcomeMessage(aff),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/affiliate/:id/payouts', adminAuth, async (req, res) => {
  try { res.json({ payouts: await store.listPayouts(req.params.id) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not load payouts.' }); }
});

// Mark paid. Defaults to the full amount currently owed (closes the double-pay gap).
app.post('/api/admin/affiliate/:id/pay', adminAuth, async (req, res) => {
  try {
    const aff = await store.getAffiliateById(req.params.id);
    if (!aff) return res.status(404).json({ error: 'Affiliate not found.' });
    const stats = await computeStats(aff);
    const amount = req.body?.amount != null ? round2(parseFloat(req.body.amount)) : stats.owed;
    if (!(amount > 0)) return res.status(400).json({ error: 'Nothing owed to pay.' });
    const payout = await store.addPayout({
      affiliateId: aff.id, amount, note: req.body?.note, createdBy: 'admin',
    });
    res.json({ ok: true, payout, venmo: aff.venmo ? `https://venmo.com/${aff.venmo}?txn=pay&amount=${amount}&note=Affiliate+Commission` : null });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Product search — affiliate searches the store, gets THEIR link for each product.
app.get('/api/products', affiliateAuth, async (req, res) => {
  const q = (req.query.q || '').toString().slice(0, 80).trim();
  if (!q) return res.json({ products: [] });
  try {
    const url = `${STORE_URL}/search/suggest.json?q=${encodeURIComponent(q)}` +
                `&resources[type]=product&resources[limit]=10`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('suggest ' + r.status);
    const j = await r.json();
    const items = (j.resources && j.resources.results && j.resources.results.products) || [];
    const tag = encodeURIComponent(req.aff.tag);
    res.json({
      products: items.map(p => ({
        title: p.title,
        image: p.image || (p.featured_image && p.featured_image.url) || null,
        link: `${STORE_URL}/products/${p.handle}?utm_source=${tag}`,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'Could not search products right now.' });
  }
});

/* ------------------------- Post Library ------------------------- */
// Affiliate: browse featured items, each with THEIR personal link.
app.get('/api/library', affiliateAuth, async (req, res) => {
  try {
    const items = await store.listPostItems(true);
    const tag = req.aff.tag;
    res.json({
      items: items.map(i => ({
        id: i.id, title: i.title, price: i.price, description: i.description,
        talking_points: i.talking_points, image: i.image_url,
        link: productLinkFor(tag, i.product_handle),
      })),
    });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Could not load the library.' }); }
});

// Admin: list / add / delete items.
app.get('/api/admin/library', adminAuth, async (_req, res) => {
  try { res.json({ items: await store.listPostItems(false) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not load items.' }); }
});

app.post('/api/admin/library', adminAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'Title is required.' });
  try {
    let image_url = b.image_url || null;
    if (b.image_base64) image_url = await store.uploadPostImage(b.image_base64, b.title);
    const item = await store.createPostItem({
      title: b.title, price: b.price, description: b.description,
      talking_points: b.talking_points, product_handle: b.product_handle, image_url,
    });
    res.json({ item });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/library/:id', adminAuth, async (req, res) => {
  try { await store.deletePostItem(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

/* ------------------------- Groups (Facebook/destash groups to join) ------------------------- */
app.get('/api/groups', affiliateAuth, async (_req, res) => {
  try {
    const items = await store.listGroups(true);
    res.json({ groups: items.map(g => ({ id: g.id, name: g.name, url: g.url, description: g.description })) });
  } catch (e) { console.error(e); res.status(502).json({ error: 'Could not load groups.' }); }
});

app.get('/api/admin/groups', adminAuth, async (_req, res) => {
  try { res.json({ groups: await store.listGroups(false) }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not load groups.' }); }
});

app.post('/api/admin/groups', adminAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.url) return res.status(400).json({ error: 'Name and link are required.' });
  try { res.json({ group: await store.createGroup({ name: b.name, url: b.url, description: b.description }) }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/groups/:id', adminAuth, async (req, res) => {
  try { await store.deleteGroup(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

/* ------------------------- Community forum ------------------------- */
app.get('/api/forum', affiliateAuth, async (_req, res) => {
  try { res.json({ posts: await store.listForum() }); }
  catch (e) { console.error(e); res.status(502).json({ error: 'Could not load the community.' }); }
});

app.post('/api/forum', affiliateAuth, async (req, res) => {
  const body = (req.body?.body || '').toString().trim().slice(0, 2000);
  const parentId = req.body?.parentId || null;
  if (!body) return res.status(400).json({ error: 'Write something first!' });
  try { res.json({ post: await store.createForumPost({ affiliateId: req.aff.id, authorName: req.aff.name, body, parentId }) }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/forum', adminAuth, async (_req, res) => {
  try { res.json({ posts: await store.listForum() }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Could not load community.' }); }
});

app.delete('/api/admin/forum/:id', adminAuth, async (req, res) => {
  try { await store.deleteForumPost(req.params.id); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

/* ------------------------- public signup ------------------------- */
// Anyone can join and instantly get their own referral link.
app.post('/api/signup', async (req, res) => {
  const b = req.body || {};
  if ((b.website || '').toString().trim()) return res.json({ ok: true }); // honeypot: silently drop bots
  const name = (b.name || '').toString().trim().slice(0, 80);
  const email = (b.email || '').toString().trim().slice(0, 120);
  const venmo = (b.venmo || '').toString().trim().replace(/^@/, '').slice(0, 60);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  try {
    const aff = await store.createAffiliate({ name, email, venmo, rate: 0.10 });
    res.json({
      name: aff.name,
      link: linkFor(aff.tag),
      portalPath: `/?token=${aff.token}`,
      welcome: welcomeMessage(aff),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Could not sign you up right now — try again.' }); }
});

app.get('/join', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'join.html')));
// Same-origin image proxy (lets flyer product photos export cleanly to PNG). Allowlisted hosts only.
app.get('/api/img', async (req, res) => {
  try {
    const url = new URL((req.query.u || '').toString());
    const ok = url.protocol === 'https:' && (/(^|\.)shopify\.com$/.test(url.hostname) || url.hostname === 'shopmidwesttees.com' || url.hostname.endsWith('.myshopify.com'));
    if (!ok) return res.status(400).end();
    const r = await fetch(url.href);
    if (!r.ok) return res.status(502).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(400).end(); }
});

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Affiliate portal v2 on :${PORT}`));
