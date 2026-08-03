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

// Ritardo di pubblicazione (8 secondi)
const METADATA_DELAY = 8000;

// Buffer massimo prima di forzare uno svuotamento (128 KB)
const MAX_BUFFER = 131072;

/**
 * Verifica se un metadato ha un formato valido "Artista - Titolo".
 * Scarta automaticamente URL, domini, pubblicità e frasi promozionali.
 */
function isValidMetadata(rawTitle) {
  if (!rawTitle || rawTitle.trim() === '') return false;

  // Deve contenere esattamente un trattino separatore " - "
  const dashIndex = rawTitle.indexOf(' - ');
  if (dashIndex === -1) return false;
  if (rawTitle.indexOf(' - ', dashIndex + 1) !== -1) return false;

  const artist = rawTitle.substring(0, dashIndex).trim();
  const title = rawTitle.substring(dashIndex + 3).trim();

  if (!artist || !title) return false;

  // L'artista non deve essere un dominio (es. fernsehlotterie.de)
  const domainPattern = /\.\w{2,4}(\/|$|\s)/;
  if (domainPattern.test(artist)) return false;
  if (artist.toLowerCase().startsWith('www.')) return false;

  // Il titolo non deve contenere parole pubblicitarie
  const blockedWords = [
    'verbraucherinformation', 'gewinnspiel', 'lotterie', 'werbung',
    'anzeige', 'gratis', 'kostenlos', 'aktion', 'teilnahmebedingungen',
    'datenschutz', 'widerrufsrecht', 'impressum', 'sponsorizzato',
    'pubblicità', 'advertising', 'information'
  ];
  const lowerTitle = title.toLowerCase();
  if (blockedWords.some(word => lowerTitle.includes(word))) return false;

  return true;
}

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };
  lastRaw[name] = '';

  let currentConnection = null;
  let reconnectTimeout = null;
  let bufferSize = 0;
  let metadataTimer = null;

  // Variabili per il ritardo di pubblicazione
  let pendingMeta = null;
  let pendingTimer = null;

  function cleanup() {
    if (metadataTimer) clearTimeout(metadataTimer);
    if (pendingTimer) clearTimeout(pendingTimer);
    if (currentConnection) {
      try { currentConnection.destroy(); } catch (e) {}
      currentConnection = null;
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    bufferSize = 0;
    pendingMeta = null;
  }

  function connect(retryCount = 0) {
    cleanup();
    console.log(`[${name}] Connessione a ${url} (tentativo ${retryCount})...`);

    const req = icy.get(url, (res) => {
      currentConnection = res;

      // Consuma i dati audio e controlla il buffer
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

      // Timeout metadati: 60 secondi senza metadati → riconnessione
      metadataTimer = setTimeout(() => {
        console.log(`[${name}] Nessun metadato da 60s, riconnessione...`);
        cleanup();
        connect(0);
      }, 60000);

      res.on('metadata', (metadata) => {
        // Reset del timer ogni volta che arriva un metadato (anche scartato)
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

        // Scarta metadati non validi (pubblicità, domini, ecc.)
        if (!isValidMetadata(raw)) {
          console.log(`[${name}] Metadato scartato: "${raw}"`);
          return;
        }

        // Estrai artista e titolo
        const dashIndex = raw.indexOf(' - ');
        const artist = raw.substring(0, dashIndex).trim();
        const title = raw.substring(dashIndex + 3).trim();

        // Metti in attesa per 8 secondi prima di pubblicare
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingMeta = { artist, title, raw };

        pendingTimer = setTimeout(() => {
          if (pendingMeta) {
            stationsMeta[name] = pendingMeta;
            console.log(`[${name}] Meta pubblicato: ${pendingMeta.artist} - ${pendingMeta.title}`);
            pendingMeta = null;
          }
        }, METADATA_DELAY);
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

// Endpoint metadati
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', stations: Object.keys(stationsMeta) });
});

app.get('/', (req, res) => res.send('Proxy attivo'));

app.listen(PORT, () => console.log(`Proxy sulla porta ${PORT}`));

// GC forzata ogni ora (invece di 3 ore) per contenere la memoria
setInterval(() => {
  console.log('GC forzata');
  if (global.gc) global.gc();
}, 3600000); // 1 ora

// Riavvio automatico ogni 6 ore per prevenire l'esaurimento della memoria
setTimeout(() => {
  console.log('Riavvio programmato per liberare memoria...');
  process.exit(0); // Render riavvierà automaticamente il processo
}, 21600000); // 6 ore
