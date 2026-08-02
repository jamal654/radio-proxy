const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://m100next.stream.laut.fm/m100next'
};

const stationsMeta = {};

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

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };

  // Stato della connessione
  let currentConnection = null;
  let reconnectTimeout = null;
  let dataListener = null;

  function cleanupConnection() {
    if (dataListener && currentConnection) {
      currentConnection.removeListener('data', dataListener);
      dataListener = null;
    }
    if (currentConnection) {
      try {
        currentConnection.destroy();
      } catch (e) {
        // già distrutto
      }
      currentConnection = null;
    }
  }

  function connect(retryCount = 0) {
    // Pulisci eventuali connessioni precedenti
    cleanupConnection();
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    console.log(`[${name}] Connessione a ${url} (tentativo ${retryCount})...`);

    const req = icy.get(url, (res) => {
      currentConnection = res;

      // Consuma esplicitamente i dati audio
      dataListener = () => {};
      res.on('data', dataListener);

      res.on('metadata', (metadata) => {
        const parsed = icy.parse(metadata);
        const raw = parsed.StreamTitle || '';

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
        console.log(`[${name}] Meta aggiornato:`, stationsMeta[name]);
      });

      res.on('end', () => {
        console.log(`[${name}] Connessione chiusa dal server.`);
        cleanupConnection();
        // Riconnetti dopo 2 secondi, ma con backoff limitato
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 15000);
        reconnectTimeout = setTimeout(() => connect(retryCount + 1), delay);
      });

      res.on('error', (err) => {
        console.error(`[${name}] Errore stream: ${err.message}`);
        cleanupConnection();
        const delay = Math.min(5000 * Math.pow(1.5, retryCount), 30000);
        reconnectTimeout = setTimeout(() => connect(retryCount + 1), delay);
      });
    });

    req.on('error', (err) => {
      console.error(`[${name}] Errore richiesta: ${err.message}`);
      cleanupConnection();
      const delay = Math.min(5000 * Math.pow(1.5, retryCount), 30000);
      reconnectTimeout = setTimeout(() => connect(retryCount + 1), delay);
    });

    // Timeout di sicurezza: se dopo 30 secondi non ci sono metadati, forza la riconnessione
    setTimeout(() => {
      if (currentConnection && stationsMeta[name].raw === '') {
        console.log(`[${name}] Nessun metadato dopo 30s, forzo riconnessione...`);
        cleanupConnection();
        connect(0);
      }
    }, 30000);
  }

  connect();
});

// Endpoint metadati
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

// Health check (opzionale, per monitorare lo stato)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', stations: Object.keys(stationsMeta) });
});

app.get('/', (req, res) => {
  res.send('Proxy attivo');
});

app.listen(PORT, () => {
  console.log(`Proxy in ascolto sulla porta ${PORT}`);
});

// Pulizia periodica forzata (ogni 6 ore) – elimina eventuali risorse residue
setInterval(() => {
  console.log('Pulizia periodica: garbage collection forzata');
  if (global.gc) {
    global.gc();
  } else {
    console.log('gc non disponibile (avvia node con --expose-gc)');
  }
}, 21600000); // 6 ore
