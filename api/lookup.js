module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { kind, word, words, apiKey } = body;
    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({ error: 'Missing API key.' });
      return;
    }
    if (!['dictionary', 'thesaurus'].includes(kind)) {
      res.status(400).json({ error: 'Invalid lookup type.' });
      return;
    }

    const requestedWords = Array.isArray(words) ? words : [word];
    const cleanWords = requestedWords
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
    if (!cleanWords.length || cleanWords.length > 8 || cleanWords.some(value => value.length > 80)) {
      res.status(400).json({ error: 'Invalid word request.' });
      return;
    }

    const reference = kind === 'dictionary' ? 'collegiate' : 'thesaurus';
    const fetchOne = async requestedWord => {
      const url = `https://www.dictionaryapi.com/api/v3/references/${reference}/json/${encodeURIComponent(requestedWord)}?key=${encodeURIComponent(apiKey)}`;
      try {
        const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
        const text = await upstream.text();
        let data;
        try { data = JSON.parse(text); }
        catch { return { word: requestedWord, status: upstream.status, error: 'Reference service returned an unreadable response.' }; }
        return { word: requestedWord, status: upstream.status, data };
      } catch {
        return { word: requestedWord, status: 502, error: 'Reference lookup failed.' };
      }
    };

    const results = await Promise.all(cleanWords.map(fetchOne));
    if (Array.isArray(words)) {
      res.status(200).json({ results });
      return;
    }

    const first = results[0];
    if (first.error) {
      res.status(first.status || 502).json({ error: first.error });
      return;
    }
    res.status(first.status || 200).json(first.data);
  } catch {
    res.status(502).json({ error: 'Reference lookup failed.' });
  }
};
