const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const STREAMS = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://m100next.stream.laut.fm/m100next'   // URL alternativo
};

const metadata = {};
const connections = {};

Object.entries(STREAMS).forEach(([name, url]) => {
  metadata[name] = { artist: '', title: '', raw: '' };

  function connect(delay = 0) {
    setTimeout(() => {
      console.log(`[${name}] Tentativo di connessione a ${url}`);
      const req = icy.get(url, {
        headers: { 'icy-metadata': '1' }
      }, (res) => {
        console.log(`[${name}] Connesso.`);
        connections[name] = res;

        res.on('metadata', (chunk) => {
          const parsed = icy.parse(chunk);
          const raw = parsed.StreamTitle || '';
          const idx = raw.indexOf(' - ');
          if (idx > 0) {
            metadata[name].artist = raw.substring(0, idx).trim();
            metadata[name].title = raw.substring(idx + 3).trim();
          } else {
            metadata[name].artist = '';
            metadata[name].title = raw.trim();
          }
          metadata[name].raw = raw;
          console.log(`[${name}] Metadati: ${metadata[name].artist} - ${metadata[name].title}`);
        });

        res.on('end', () => {
          console.log(`[${name}] Stream chiuso dal server, riconnessione tra 2s...`);
          connections[name] = null;
          connect(2000);
        });

        res.on('error', (err) => {
          console.error(`[${name}] Errore stream: ${err.message}`);
          connections[name] = null;
          connect(5000);
        });

        // Timeout di inattività: se non arrivano dati per 45 secondi, forza chiusura
        let idleTimer = setTimeout(() => {
          console.log(`[${name}] Nessun dato per 45s, riconnessione forzata.`);
          res.destroy();
        }, 45000);

        res.on('data', () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            console.log(`[${name}] Nessun dato per 45s, riconnessione forzata.`);
            res.destroy();
          }, 45000);
        });

        res.resume();
      });

      req.on('error', (err) => {
        console.error(`[${name}] Errore richiesta: ${err.message}`);
        connections[name] = null;
        connect(10000);
      });

    }, delay);
  }

  connect(0);
});

// Endpoint metadati
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!metadata[station]) return res.status(404).json({ error: 'Stazione non trovata' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(metadata[station]);
});

// Health check
app.get('/health', (req, res) => {
  const statuses = {};
  let healthy = true;
  Object.keys(STREAMS).forEach(name => {
    const conn = connections[name];
    const alive = conn && !conn.destroyed;
    statuses[name] = alive ? 'connected' : 'disconnected';
    if (!alive) healthy = false;
  });
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', stations: statuses });
});

app.get('/', (req, res) => res.send('Proxy attivo. /current-meta/... - /health'));

app.listen(PORT, () => console.log(`Proxy in ascolto sulla porta ${PORT}`));
