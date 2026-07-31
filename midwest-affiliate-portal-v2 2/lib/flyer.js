// AI flyer generator: Claude writes the copy, Google (Gemini) paints the image,
// compositing the affiliate's chosen REAL product photos from the store.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const COPY_MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-latest';
const IMG_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

// Claude writes a punchy headline + subhead for the flyer.
export async function flyerCopy(theme, products = []) {
  const t = (theme || '').toString().slice(0, 300).trim();
  const names = (Array.isArray(products) ? products : [])
    .map(p => p && p.title).filter(Boolean).slice(0, 3).join(', ');
  const ctx = [t && `Theme: ${t}`, names && `Featured products: ${names}`]
    .filter(Boolean).join('. ') || 'MidWest Tees custom tees and spirit-wear';
  try {
    const res = await anthropic.messages.create({
      model: COPY_MODEL,
      max_tokens: 200,
      system: `You write short, punchy PRINT-FLYER copy for MidWest Tees, a Midwest custom spirit-wear and T-shirt shop (shopmidwesttees.com). Respond with ONLY compact JSON: {"headline":"...","subhead":"..."}. headline = 2 to 5 words, bold and catchy (ALL CAPS is fine). subhead = one short line, 10 words max. No hashtags, no emojis, no quote marks inside the values, no extra text — just the JSON object.`,
      messages: [{ role: 'user', content: ctx }],
    });
    const txt = res.content.filter(c => c.type === 'text').map(c => c.text).join('').trim();
    const j = JSON.parse(txt.replace(/```json|```/g, '').trim());
    return {
      headline: String(j.headline || '').slice(0, 40) || 'SHOP MIDWEST TEES',
      subhead: String(j.subhead || '').slice(0, 80) || 'Custom tees & spirit-wear',
    };
  } catch (e) {
    return { headline: 'SHOP MIDWEST TEES', subhead: 'Custom tees & spirit-wear' };
  }
}

// Fetch a store product image and return it base64 (only from our own store/CDN).
async function fetchRef(imageUrl) {
  try {
    const u = new URL((imageUrl || '').toString());
    const ok = u.protocol === 'https:' && (
      /(^|\.)shopify\.com$/.test(u.hostname) ||
      u.hostname === 'shopmidwesttees.com' ||
      u.hostname.endsWith('.myshopify.com')
    );
    if (!ok) return null;
    const r = await fetch(u.href);
    if (!r.ok) return null;
    const mime = r.headers.get('content-type') || 'image/jpeg';
    const dataB64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    return { mimeType: mime, dataB64 };
  } catch (e) { return null; }
}

// Google Gemini ("Nano Banana", gemini-2.5-flash-image) makes the flyer image.
// If the affiliate picked products, their EXACT photos are composited in — the
// model is told not to redraw the designs. Same call shape/key as MSM Market.
export async function flyerImage(theme, products = []) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { image: null, error: 'no_key' };
  const headline = (theme || 'SHOP MIDWEST TEES').toString().slice(0, 120).trim();
  const picks = (Array.isArray(products) ? products : []).slice(0, 3);

  const refs = [];
  for (const p of picks) {
    if (p && p.image) { const ref = await fetchRef(p.image); if (ref) refs.push(ref); }
  }
  const names = picks.map(p => p && p.title).filter(Boolean).join(', ');

  let prompt;
  if (refs.length) {
    prompt = `Design a COMPLETE, professional high-school spirit-store promotional flyer/poster for MidWest Tees, a Midwest custom spirit-wear and T-shirt shop. BIG TITLE: render this exact headline across the top, spelled EXACTLY as written and clearly legible, in bold outlined collegiate/varsity block lettering: "${headline}". Add a small supporting tagline beneath it such as "GEAR UP — SHOP NOW". PRODUCTS: the attached images are real photographs of the actual products${names ? ` (${names})` : ''}. Arrange these EXACT product photos in a clean grid/collage as the centerpiece. Do NOT redraw, re-letter, restyle, or recolor the printed designs or garments — keep every printed design and the exact garment color pixel-accurate to the references; you may resize, rotate, reposition, and add realistic shadows. STYLE: bold red and black brand colors, a subtle patterned background, a decorative sports border around all four edges (footballs, basketballs, pom-poms, paw prints, stars), and a "SHOP NOW" ribbon banner near the bottom. Energetic, eye-catching, print-ready poster quality. Spell ALL text correctly and legibly. Do NOT include any QR codes, phone numbers, web addresses, URLs, or prices.`;
  } else {
    prompt = `Design a COMPLETE, professional spirit-store promotional flyer/poster for MidWest Tees, a Midwest custom spirit-wear and T-shirt shop. BIG TITLE across the top, spelled EXACTLY and clearly legible, in bold outlined varsity block lettering: "${headline}". A small tagline beneath such as "GEAR UP — SHOP NOW". Feature a few stylish custom tees and apparel as the centerpiece. STYLE: bold red and black brand colors, a patterned background, a decorative sports border (footballs, basketballs, pom-poms, paw prints, stars), and a "SHOP NOW" ribbon near the bottom. Print-ready poster quality. Spell all text correctly. No QR codes, phone numbers, URLs, or prices.`;
  }

  const parts = [{ text: prompt }];
  for (const r of refs) parts.push({ inline_data: { mime_type: r.mimeType, data: r.dataB64 } });

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('flyerImage API error', res.status, detail.slice(0, 300));
      return { image: null, error: 'api' };
    }
    const j = await res.json();
    const cparts = j?.candidates?.[0]?.content?.parts || [];
    for (const p of cparts) {
      const inline = p.inline_data || p.inlineData;
      if (inline?.data) {
        const mime = (p.inline_data?.mime_type) || (p.inlineData?.mimeType) || 'image/png';
        return { image: `data:${mime};base64,${inline.data}`, error: null };
      }
    }
    return { image: null, error: 'no_image' };
  } catch (e) {
    console.error('flyerImage error', e);
    return { image: null, error: 'exception' };
  }
}
