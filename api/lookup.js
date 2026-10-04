module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { kind, word, apiKey } = body;

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ error: 'Missing API key.' });
      return;
    }

    if (!word || typeof word !== 'string' || word.length > 80) {
      res.status(400).json({ error: 'Invalid word.' });
      return;
    }

    if (!['dictionary', 'thesaurus'].includes(kind)) {
      res.status(400).json({ error: 'Invalid lookup type.' });
      return;
    }

    const reference = kind === 'dictionary' ? 'collegiate' : 'thesaurus';

    const url =
      `https://www.dictionaryapi.com/api/v3/references/${reference}/json/` +
      `${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    const text = await upstream.text();

    res.status(upstream.status);

    try {
      res.json(JSON.parse(text));
    } catch {
      res.json({
        error: 'Reference service returned an unreadable response.'
      });
    }
  } catch (error) {
    res.status(502).json({
      error: 'Reference lookup failed.'
    });
  }
};
