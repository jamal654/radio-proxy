const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://m100next.stream.laut.fm/m100next'
};

const stationsMeta = {};
const lastRaw = {};

// Filtro pubblicità
const BLOCKED_KEYWORDS = [
  'aktion-mensch',
  'verbraucherinformation',
  'information',
  'verbraucher',
  'spot pubblicitario',
  'pubblicità',
  'advertising'
];

function isBlocked(rawTitle) {
  const lower = rawTitle.toLowerCase();
  return BLOCKED_KEYWORDS.some(keyword => lower.includes(keyword));
}

const MAX_BUFFER = 262144; // 256 KB

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };
  lastRaw[name] = '';

  let currentConnection = null;
  let reconnectTimeout = null;
  let bufferSize = 0;
  let metadataTimer = null;

  function cleanup() {
    if (metadataTimer) clearTimeout(metadataTimer);
    if (currentConnection) {
      try { currentConnection.destroy(); } catch (e) {}
      currentConnection = null;
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    bufferSize = 0;
  }

  function connect(retryCount = 0) {
    cleanup();
    console.log(`[${name}] Connessione a ${url} (tentativo ${retryCount})...`);

    const req = icy.get(url, (res) => {
      currentConnection = res;

      // Consuma i dati audio
      res.on('data', (chunk) => {
        bufferSize += chunk.length;
        if (bufferSize > MAX_BUFFER) {
          bufferSize = 0;
          res.pause();
          setImmediate(() => {
            if (currentConnection === res) res.resume();
          });
        }
      });

      // Timeout metadati: si resetta OGNI volta che arriva un blocco
      metadataTimer = setTimeout(() => {
        console.log(`[${name}] Nessun metadato da 60s, riconnessione...`);
        cleanup();
        connect(0);
      }, 60000);

      res.on('metadata', (metadata) => {
        // Reset del timer
        clearTimeout(metadataTimer);
        metadataTimer = setTimeout(() => {
          console.log(`[${name}] Nessun metadato da 60s, riconnessione...`);
          cleanup();
          connect(0);
        }, 60000);

        const parsed = icy.parse(metadata);
        const raw = parsed.StreamTitle || '';

        // Salta se è lo stesso titolo di prima
        if (raw === lastRaw[name]) return;
        lastRaw[name] = raw;

        // Se è bloccato, non aggiornare
        if (isBlocked(raw)) {
          console.log(`[${name}] Metadato bloccato: "${raw}"`);
          return;
        }

        // Estrai artista e titolo
        const dashIndex = raw.indexOf(' - ');
        if (dashIndex > 0) {
          stationsMeta[name].artist = raw.substring(0, dashIndex).trim();
          stationsMeta[name].title = raw.substring(dashIndex + 3).trim();
        } else {
          stationsMeta[name].artist = '';
          stationsMeta[name].title = raw.trim();
        }
        stationsMeta[name].raw = raw;

        console.log(`[${name}] Meta: ${stationsMeta[name].artist} - ${stationsMeta[name].title}`);
      });

      res.on('end', () => {
        console.log(`[${name}] Connessione chiusa.`);
        cleanup();
        reconnectTimeout = setTimeout(() => connect(retryCount + 1), 2000);
      });

      res.on('error', (err) => {
        console.error(`[${name}] Errore stream: ${err.message}`);
        cleanup();
        reconnectTimeout = setTimeout(() => connect(retryCount + 1), 5000);
      });
    });

    req.on('error', (err) => {
      console.error(`[${name}] Errore richiesta: ${err.message}`);
      cleanup();
      reconnectTimeout = setTimeout(() => connect(retryCount + 1), 10000);
    });
  }

  connect();
});

// Endpoint metadati (senza cache, per evitare ritardi)
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', stations: Object.keys(stationsMeta) });
});

app.get('/', (req, res) => res.send('Proxy attivo'));

app.listen(PORT, () => console.log(`Proxy sulla porta ${PORT}`));

// GC forzata ogni 3 ore
setInterval(() => {
  console.log('GC forzata');
  if (global.gc) global.gc();
}, 10800000);
