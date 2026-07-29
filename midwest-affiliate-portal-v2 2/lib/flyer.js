// AI flyer generator: Claude writes the copy, Google (Gemini) paints the image.
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const COPY_MODEL = process.env.AI_MODEL || 'claude-3-5-haiku-latest';
const IMG_MODEL = process.env.GOOGLE_IMAGE_MODEL || 'gemini-2.5-flash-image';

// Claude writes a punchy headline + subhead for the flyer.
export async function flyerCopy(theme) {
  const t = (theme || '').toString().slice(0, 300).trim() || 'MidWest Tees custom tees and spirit-wear';
  try {
    const res = await anthropic.messages.create({
      model: COPY_MODEL,
      max_tokens: 200,
      system: `You write short, punchy PRINT-FLYER copy for MidWest Tees, a Midwest custom spirit-wear and T-shirt shop (shopmidwesttees.com). Given a theme, respond with ONLY compact JSON: {"headline":"...","subhead":"..."}. headline = 2 to 5 words, bold and catchy (ALL CAPS is fine). subhead = one short line, 10 words max. No hashtags, no emojis, no quote marks inside the values, no extra text — just the JSON object.`,
      messages: [{ role: 'user', content: `Theme: ${t}` }],
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

// Google Gemini paints a text-free flyer background from the theme.
export async function flyerImage(theme) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { image: null, error: 'no_key' };
  const t = (theme || '').toString().slice(0, 300).trim();
  const prompt = `A clean, eye-catching promotional flyer background for a Midwest custom T-shirt and spirit-wear brand. Theme: ${t || 'casual everyday tees'}. Bold, modern, warm, poster-like, high quality. Leave generous empty space near the top and bottom for text to be added later. IMPORTANT: do not render any words, letters, or logos in the image.`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('flyerImage API error', r.status, detail.slice(0, 300));
      return { image: null, error: 'api' };
    }
    const j = await r.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const img = parts.find(p => p.inlineData?.data);
    if (!img) return { image: null, error: 'no_image' };
    return { image: `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`, error: null };
  } catch (e) {
    console.error('flyerImage error', e);
    return { image: null, error: 'exception' };
  }
}
