const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Elenco delle stazioni: chiave → URL stream
const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://stream.laut.fm/m100next'   // il tuo URL confermato
};

// Oggetto per conservare i metadati di ogni stazione
const stationsMeta = {};

// Avvia una connessione ICY per ciascuna stazione
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

// Endpoint per ottenere i metadati di una stazione specifica
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

// Health check
app.get('/', (req, res) => {
  res.send('Proxy metadati multi-stazione attivo. Usa /current-meta/radio-m100 o /current-meta/radio-m100next');
});

app.listen(PORT, () => {
  console.log(`Proxy in ascolto sulla porta ${PORT} per le stazioni:`, Object.keys(streams).join(', '));
});
