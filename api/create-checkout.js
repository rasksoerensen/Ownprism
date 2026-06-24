// Vercel serverless function: POST /api/create-checkout
const Stripe = require('stripe');

function detectKeyMode(key) {
  if (!key) return null;
  if (key.startsWith('sk_live_')) return 'live';
  if (key.startsWith('sk_test_')) return 'test';
  return null;
}
function fingerprint(key) {
  if (!key) return '';
  return key.slice(0, 7) + '...' + key.slice(-4);
}

async function validateConfig() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, status: 500, error: 'STRIPE_SECRET_KEY is not configured on the server.' };
  const keyMode = detectKeyMode(key);
  if (!keyMode) return {
    ok: false, status: 500,
    error: "STRIPE_SECRET_KEY must start with 'sk_test_' or 'sk_live_'. Publishable keys (pk_*) are not accepted.",
  };

  const stripe = Stripe(key);
  try {
    await stripe.balance.retrieve();
  } catch (e) {
    if (e && e.type === 'StripeAuthenticationError') {
      return { ok: false, status: 500, error: `Invalid STRIPE_SECRET_KEY (${fingerprint(key)}) - authentication failed.` };
    }
    return { ok: false, status: 502, error: `Stripe API unreachable: ${e.message || 'unknown error'}` };
  }

  const priceId = process.env.STRIPE_PRICE_ID || null;
  if (priceId) {
    let price;
    try {
      price = await stripe.prices.retrieve(priceId);
    } catch (e) {
      if (e && e.code === 'resource_missing') {
        return { ok: false, status: 500, error: `Price '${priceId}' not found in ${keyMode} mode. Confirm it belongs to the same Stripe account and mode as STRIPE_SECRET_KEY.` };
      }
      return { ok: false, status: 502, error: `Failed to retrieve price '${priceId}': ${e.message}` };
    }
    const priceMode = price.livemode ? 'live' : 'test';
    if (priceMode !== keyMode) {
      return { ok: false, status: 500, error: `Price '${priceId}' is a ${priceMode} price but STRIPE_SECRET_KEY is a ${keyMode} key. Use a ${keyMode}-mode price ID or switch keys.` };
    }
    if (!price.active) {
      return { ok: false, status: 500, error: `Price '${priceId}' is archived. Activate it in the Stripe dashboard or remove STRIPE_PRICE_ID to use the built-in EUR 4.99 price.` };
    }
  }

  return { ok: true, stripe, keyMode, priceId };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const config = await validateConfig();
  if (!config.ok) {
    console.error('[create-checkout] config invalid:', config.error);
    return res.status(config.status).json({ error: config.error });
  }
  const { stripe, priceId } = config;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const quizType = typeof body.quizType === 'string' ? body.quizType : 'unknown';
  const answers = Array.isArray(body.answers) ? body.answers : [];

  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const origin = `${proto}://${host}`;
  const answersParam = encodeURIComponent(JSON.stringify(answers));

  const lineItem = priceId
    ? { price: priceId, quantity: 1 }
    : {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: 499,
          product_data: {
            name: 'OwnPrism Full Personality Report',
            description: 'AI-generated deep-dive based on your quiz answers.',
          },
        },
      };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [lineItem],
      success_url: `${origin}/?success=true&quiz=${encodeURIComponent(quizType)}&answers=${answersParam}`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: { quizType },
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('[create-checkout] session create failed:', e);
    return res.status(502).json({ error: `Stripe could not create the checkout session: ${e.message}` });
  }
};
