const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Entrambe le stazioni
const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://m100next.stream.laut.fm/m100next'
};

const stationsMeta = {};

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };

  function connect() {
    console.log(`[${name}] Connessione a ${url}...`);
    icy.get(url, (res) => {
      res.on('metadata', (metadata) => {
        const parsed = icy.parse(metadata);
        const raw = parsed.StreamTitle || '';
        const dashIndex = raw.indexOf(' - ');
        if (dashIndex > 0) {
          stationsMeta[name].artist = raw.substring(0, dashIndex).trim();
          stationsMeta[name].title = raw.substring(dashIndex + 3).trim();
        } else {
          stationsMeta[name].artist = '';
          stationsMeta[name].title = raw.trim();
        }
        stationsMeta[name].raw = raw;
        console.log(`[${name}] Meta aggiornato:`, stationsMeta[name]);
      });

      res.on('end', () => {
        console.log(`[${name}] Connessione persa, riconnessione tra 5s...`);
        setTimeout(connect, 5000);
      });

      res.on('error', (err) => {
        console.error(`[${name}] Errore:`, err);
        setTimeout(connect, 5000);
      });

      res.resume();
    });
  }

  connect();
});

app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

app.get('/', (req, res) => {
  res.send('Proxy attivo');
});

app.listen(PORT, () => {
  console.log(`Proxy in ascolto sulla porta ${PORT}`);
});
