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
