// MidWest Tees — Affiliate Portal v2
// Scoped AI helper + live Shopify commissions + Supabase roster/payouts + owner dashboard.
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { salesForTag } from './lib/shopify.js';
import * as store from './lib/db.js';
import { askHelper } from './lib/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_URL = process.env.STORE_URL || 'https://shopmidwesttees.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => console.log(`Affiliate portal v2 on :${PORT}`));
