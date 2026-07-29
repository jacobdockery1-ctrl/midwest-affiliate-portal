// Supabase data layer. Uses the SERVICE ROLE key (server-side only) and bypasses RLS.
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

export const db = createClient(url, key, { auth: { persistSession: false } });

export function newToken() {
  return crypto.randomBytes(24).toString('base64url'); // ~32 chars, URL-safe
}

export function slugifyTag(name) {
  return String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'aff';
}

export async function getAffiliateByToken(token) {
  if (!token) return null;
  const { data } = await db.from('mw_affiliates').select('*').eq('token', token).maybeSingle();
  return data || null;
}

export async function getAffiliateById(id) {
  const { data } = await db.from('mw_affiliates').select('*').eq('id', id).maybeSingle();
  return data || null;
}

export async function listAffiliates() {
  const { data } = await db.from('mw_affiliates').select('*').order('created_at', { ascending: true });
  return data || [];
}

export async function createAffiliate({ name, email, venmo, rate }) {
  // ensure unique tag
  let base = slugifyTag(name), tag = base, n = 1;
  while ((await db.from('mw_affiliates').select('id').eq('tag', tag).maybeSingle()).data) {
    tag = `${base}${++n}`;
  }
  const row = {
    name, email: email || null, venmo: venmo || null,
    tag, token: newToken(), commission_rate: rate ?? 0.10, status: 'active',
  };
  const { data, error } = await db.from('mw_affiliates').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function paidTotal(affiliateId) {
  const { data } = await db.from('mw_payouts').select('amount').eq('affiliate_id', affiliateId);
  return (data || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0);
}

export async function listPayouts(affiliateId) {
  const { data } = await db.from('mw_payouts')
    .select('*').eq('affiliate_id', affiliateId).order('paid_at', { ascending: false });
  return data || [];
}

export async function addPayout({ affiliateId, amount, note, createdBy }) {
  const { data, error } = await db.from('mw_payouts')
    .insert({ affiliate_id: affiliateId, amount, note: note || null, created_by: createdBy || 'admin' })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function logChat({ affiliateId, question, answer }) {
  try { await db.from('mw_chat_logs').insert({ affiliate_id: affiliateId, question, answer }); }
  catch { /* logging is best-effort */ }
}

/* ------------------------- Post Library ------------------------- */
export async function listPostItems(activeOnly = false) {
  let q = db.from('mw_post_items').select('*').order('sort', { ascending: true }).order('created_at', { ascending: false });
  if (activeOnly) q = q.eq('active', true);
  const { data } = await q;
  return data || [];
}

export async function createPostItem(fields) {
  const row = {
    title: fields.title,
    price: fields.price || null,
    description: fields.description || null,
    talking_points: fields.talking_points || null,
    image_url: fields.image_url || null,
    product_handle: fields.product_handle || null,
  };
  const { data, error } = await db.from('mw_post_items').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deletePostItem(id) {
  const { error } = await db.from('mw_post_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

/* ------------------------- Groups ------------------------- */
export async function listGroups(activeOnly = false) {
  let q = db.from('mw_groups').select('*').order('sort', { ascending: true }).order('created_at', { ascending: false });
  if (activeOnly) q = q.eq('active', true);
  const { data } = await q;
  return data || [];
}

export async function createGroup(fields) {
  const row = { name: fields.name, url: fields.url, description: fields.description || null };
  const { data, error } = await db.from('mw_groups').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteGroup(id) {
  const { error } = await db.from('mw_groups').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

/* ------------------------- Community forum ------------------------- */
export async function listForum() {
  const { data } = await db.from('mw_forum').select('*').order('created_at', { ascending: true });
  const rows = data || [];
  const posts = rows.filter(r => !r.parent_id).map(p => ({ ...p, replies: rows.filter(r => r.parent_id === p.id) }));
  posts.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return posts;
}

export async function createForumPost({ affiliateId, authorName, body, parentId }) {
  const row = { affiliate_id: affiliateId || null, author_name: authorName || 'Affiliate', body, parent_id: parentId || null };
  const { data, error } = await db.from('mw_forum').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteForumPost(id) {
  const { error } = await db.from('mw_forum').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}

// Upload a base64 data URL (or raw base64) to storage, return public URL.
export async function uploadPostImage(base64, name) {
  let b64 = base64, contentType = 'image/jpeg';
  const m = /^data:(.+?);base64,(.*)$/.exec(base64 || '');
  if (m) { contentType = m[1]; b64 = m[2]; }
  const buffer = Buffer.from(b64, 'base64');
  const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const path = `${Date.now()}-${(name || 'img').replace(/[^a-z0-9._-]/gi, '_').slice(0, 40)}.${ext}`;
  const { error } = await db.storage.from('mw-post-images').upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  const { data } = db.storage.from('mw-post-images').getPublicUrl(path);
  return data.publicUrl;
}
