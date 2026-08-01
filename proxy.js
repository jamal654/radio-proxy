const icy = require('icy');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Stazioni
const streams = {
  'radio-m100': 'https://radio-m100.stream.laut.fm/radio-m100',
  'radio-m100next': 'https://m100next.stream.laut.fm/m100next'
};

const stationsMeta = {};
const connections = {};

Object.entries(streams).forEach(([name, url]) => {
  stationsMeta[name] = { artist: '', title: '', raw: '' };

  function connect(retryCount = 0) {
    if (connections[name]) {
      try { connections[name].destroy(); } catch(e) {}
    }
    console.log(`[${name}] Connessione a ${url} (tentativo ${retryCount})...`);
    
    const req = icy.get(url, {
      headers: { 'icy-metadata': '1' }
    }, (res) => {
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
        console.log(`[${name}] Nuovo brano: ${stationsMeta[name].artist} - ${stationsMeta[name].title}`);
      });

      res.on('end', () => {
        console.log(`[${name}] Connessione chiusa, riconnessione immediata...`);
        connections[name] = null;
        connect(0);
      });

      res.on('error', (err) => {
        console.error(`[${name}] Errore nello stream:`, err);
        connections[name] = null;
        const delay = Math.min(2000 * Math.pow(2, retryCount), 30000);
        setTimeout(() => connect(retryCount + 1), delay);
      });

      res.resume();
    });

    req.on('error', (err) => {
      console.error(`[${name}] Errore di richiesta:`, err);
      const delay = Math.min(2000 * Math.pow(2, retryCount), 30000);
      setTimeout(() => connect(retryCount + 1), delay);
    });
  }

  connect();
});

// Metadati
app.get('/current-meta/:station', (req, res) => {
  const { station } = req.params;
  if (!stationsMeta[station]) {
    return res.status(404).json({ error: 'Stazione non trovata' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(stationsMeta[station]);
});

// Health check (verifica connessioni attive)
app.get('/health', (req, res) => {
  const statuses = {};
  let allOk = true;
  Object.keys(streams).forEach(name => {
    const connected = connections[name] && !connections[name].destroyed;
    statuses[name] = connected ? 'connected' : 'disconnected';
    if (!connected) allOk = false;
  });
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    stations: statuses
  });
});

app.get('/', (req, res) => {
  res.send('Proxy attivo. /current-meta/radio-m100 - /health');
});

app.listen(PORT, () => {
  console.log(`Proxy in ascolto sulla porta ${PORT}`);
});
