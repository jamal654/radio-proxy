const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://stream.laut.fm/m100next'
};

const stationsMeta = {};
const connections = {};   // tiene traccia delle connessioni attive

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };

  function connect(retryCount = 0) {
    if (connections[name]) {
      try { connections[name].destroy(); } catch(e) {}
    }
    console.log(`[${name}] Connessione a ${url} (tentativo ${retryCount})...`);
    
    const req = icy.get(url, (res) => {
      connections[name] = res;
      console.log(`[${name}] Connesso.`);
      
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
        console.log(`[${name}] Connessione chiusa, riconnessione tra 5s...`);
        connections[name] = null;
        setTimeout(() => connect(0), 5000);
      });

      res.on('error', (err) => {
        console.error(`[${name}] Errore:`, err);
        connections[name] = null;
        const delay = Math.min(5000 * Math.pow(2, retryCount), 60000); // backoff fino a 1 min
        setTimeout(() => connect(retryCount + 1), delay);
      });

      // Consuma i dati
      res.resume();
    });

    req.on('error', (err) => {
      console.error(`[${name}] Errore richiesta:`, err);
      const delay = Math.min(5000 * Math.pow(2, retryCount), 60000);
      setTimeout(() => connect(retryCount + 1), delay);
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

// Health check avanzato
app.get('/health', (req, res) => {
  const statuses = {};
  let allConnected = true;
  Object.keys(streams).forEach(name => {
    const connected = connections[name] && !connections[name].destroyed;
    statuses[name] = connected ? 'connected' : 'disconnected';
    if (!connected) allConnected = false;
  });
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? 'ok' : 'degraded',
    stations: statuses
  });
});

// Auto-ping ogni 10 minuti per evitare standby (anche senza UptimeRobot)
setInterval(() => {
  console.log('Auto-ping per keep-alive');
  // fa una richiesta a se stesso (localhost)
  const http = require('http');
  http.get(`http://localhost:${PORT}/health`, (resp) => {});
}, 600000); // 10 minuti

app.get('/', (req, res) => {
  res.send('Proxy multi-stazione attivo. Usa /current-meta/radio-m100 o /health');
});

app.listen(PORT, () => {
  console.log(`Proxy in ascolto sulla porta ${PORT}`);
});
