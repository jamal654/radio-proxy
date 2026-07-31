const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Inserisci l'URL del tuo stream laut.fm
const STREAM_URL = process.env.STREAM_URL || 'https://radio-m100.stream.laut.fm/radio-m100';

let currentMeta = { artist: '', title: '', raw: '' };

function connectToStream() {
  console.log('Connessione allo stream...');
  icy.get(STREAM_URL, (res) => {
    res.on('metadata', (metadata) => {
      const parsed = icy.parse(metadata);
      const raw = parsed.StreamTitle || '';
      currentMeta.raw = raw;
      const dashIndex = raw.indexOf(' - ');
      if (dashIndex > 0) {
        currentMeta.artist = raw.substring(0, dashIndex).trim();
        currentMeta.title = raw.substring(dashIndex + 3).trim();
      } else {
        currentMeta.artist = '';
        currentMeta.title = raw.trim();
      }
      console.log('Meta aggiornato:', currentMeta);
    });

    res.on('end', () => {
      console.log('Connessione persa, riconnessione tra 5 secondi...');
      setTimeout(connectToStream, 5000);
    });

    res.on('error', (err) => {
      console.error('Errore:', err);
      setTimeout(connectToStream, 5000);
    });

    // Importante: consumare i dati audio per non intasare la memoria
    res.resume();
  });
}

app.get('/current-meta', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(currentMeta);
});

app.listen(PORT, () => {
  console.log(`Proxy metadati in ascolto sulla porta ${PORT}`);
  connectToStream();
});
