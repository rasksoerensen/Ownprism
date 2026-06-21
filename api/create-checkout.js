module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { quizType, answers } = req.body;
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      return res.status(500).json({ error: 'Stripe secret key not configured' });
    }

    const successUrl = `https://www.ownprism.com?success=true&quiz=${quizType}&answers=${encodeURIComponent(JSON.stringify(answers))}`;
    const cancelUrl = `https://www.ownprism.com?cancelled=true`;

    const params = new URLSearchParams();
    params.append('payment_method_types[0]', 'card');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][product_data][name]', 'OwnPrism Full Personality Report');
    params.append('line_items[0][price_data][product_data][description]', `Deep AI analysis of your ${quizType} personality type`);
    params.append('line_items[0][price_data][unit_amount]', '499');
    params.append('line_items[0][quantity]', '1');
    params.append('mode', 'payment');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();

    if (session.error) {
      console.error('Stripe error:', session.error);
      return res.status(500).json({ error: session.error.message });
    }

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
};
