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
const cache = {};
const CACHE_TTL = 2000;

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
  cache[name] = { data: null, timestamp: 0 };

  let currentConnection = null;
  let reconnectTimeout = null;
  let dataListener = null;
  let bufferSize = 0;
  let metadataTimer = null;

  function cleanup() {
    if (dataListener && currentConnection) {
      currentConnection.removeListener('data', dataListener);
      dataListener = null;
    }
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

      dataListener = (chunk) => {
        bufferSize += chunk.length;
        if (bufferSize > MAX_BUFFER) {
          bufferSize = 0;
          res.pause();
          setImmediate(() => {
            if (currentConnection === res) res.resume();
          });
        }
      };
      res.on('data', dataListener);

      // Timeout metadati: si resetta OGNI volta che arriva un blocco (anche scartato)
      metadataTimer = setTimeout(() => {
        console.log(`[${name}] Nessun metadato da 60s, riconnessione...`);
        cleanup();
        connect(0);
      }, 60000);

      res.on('metadata', (metadata) => {
        // Reset del timer immediato (prima di qualsiasi controllo)
        clearTimeout(metadataTimer);
        metadataTimer = setTimeout(() => {
          console.log(`[${name}] Nessun metadato da 60s, riconnessione...`);
          cleanup();
          connect(0);
        }, 60000);

        const parsed = icy.parse(metadata);
        const raw = parsed.StreamTitle || '';

        if (raw === lastRaw[name]) return;
        lastRaw[name] = raw;

        if (isBlocked(raw)) {
          console.log(`[${name}] Metadato bloccato: "${raw}"`);
          return;
        }

        const dashIndex = raw.indexOf(' - ');
        if (dashIndex > 0) {
          stationsMeta[name].artist = raw.substring(0, dashIndex).trim();
          stationsMeta[name].title = raw.substring(dashIndex + 3).trim();
        } else {
          stationsMeta[name].artist = '';
          stationsMeta[name].title = raw.trim();
        }
        stationsMeta[name].raw = raw;
        cache[name].timestamp = 0;
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

app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }

  const now = Date.now();
  const cached = cache[station];

  if (cached && cached.data && (now - cached.timestamp) < CACHE_TTL) {
    return res.json(cached.data);
  }

  cached.data = { ...stationsMeta[station] };
  cached.timestamp = now;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', stations: Object.keys(stationsMeta) });
});

app.get('/', (req, res) => res.send('Proxy attivo'));

app.listen(PORT, () => console.log(`Proxy sulla porta ${PORT}`));

setInterval(() => {
  console.log('GC forzata');
  if (global.gc) global.gc();
}, 10800000);
