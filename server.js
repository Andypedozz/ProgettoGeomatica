const express = require('express');
const cors = require("cors");
const path = require('path');
// Usa globalThis.fetch (Node 18+) o node-fetch per retrocompatibilità
const fetch = globalThis.fetch || require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Abilita CORS per tutte le route
app.use(cors());

// Middleware per parsing JSON
app.use(express.json());

// Servi i file statici dalla directory corrente
app.use(express.static(__dirname));

// Route principale - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Proxy per Open-Elevation API (con rate limiting e cache)
const elevationCache = new Map();
const requestTimestamps = [];

// Rate limiting: max 10 richieste al secondo (disabilitato nei test)
function checkRateLimit() {
    if (process.env.VITEST) return true;

    const now = Date.now();
    const windowStart = now - 1000;

    // Rimuovi timestamps più vecchi di 1 secondo
    while (requestTimestamps.length > 0 && requestTimestamps[0] < windowStart) {
        requestTimestamps.shift();
    }

    if (requestTimestamps.length >= 10) {
        return false;
    }

    requestTimestamps.push(now);
    return true;
}

// Endpoint proxy per elevation (singolo punto)
app.get('/api/elevation', async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'lat e lng devono essere numeri validi' });
    }

    // Normalizza le coordinate per chiave cache consistente
    const cacheKey = `${parseFloat(lat)},${parseFloat(lng)}`;

    // Controlla cache
    if (elevationCache.has(cacheKey)) {
        console.log(`Cache hit per ${cacheKey}`);
        return res.json(elevationCache.get(cacheKey));
    }

    // Rate limiting
    if (!checkRateLimit()) {
        return res.status(429).json({ error: 'Troppe richieste. Attendi un momento.' });
    }

    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        // Salva in cache per 1 ora
        elevationCache.set(cacheKey, data);
        setTimeout(() => elevationCache.delete(cacheKey), 3600000);

        res.json(data);
    } catch (error) {
        console.error('Errore proxy elevation:', error);
        res.status(500).json({ error: 'Errore nel recupero dell\'elevazione' });
    }
});

// Endpoint proxy per elevation multiple (batch)
app.post('/api/elevation/batch', async (req, res) => {
    const { locations } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
        return res.status(400).json({ error: 'locations array è richiesto' });
    }

    // Limita a massimo 50 coordinate per batch
    if (locations.length > 50) {
        return res.status(400).json({ error: 'Massimo 50 coordinate per batch' });
    }

    const results = [];
    const uncachedLocations = [];

    // Controlla cache (con chiave normalizzata)
    for (const loc of locations) {
        const cacheKey = `${parseFloat(loc.lat)},${parseFloat(loc.lng)}`;
        if (elevationCache.has(cacheKey)) {
            results.push(elevationCache.get(cacheKey));
        } else {
            uncachedLocations.push(loc);
        }
    }

    if (uncachedLocations.length === 0) {
        return res.json({ results });
    }

    // Rate limiting per batch
    if (!checkRateLimit()) {
        return res.status(429).json({ error: 'Troppe richieste. Attendi un momento.' });
    }

    const locationString = uncachedLocations.map(loc => `${loc.lat},${loc.lng}`).join('|');
    const url = `https://api.open-elevation.com/api/v1/lookup?locations=${locationString}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.results) {
            data.results.forEach((result, index) => {
                const loc = uncachedLocations[index];
                const cacheKey = `${loc.lat},${loc.lng}`;
                const resultData = { results: [result] };

                elevationCache.set(cacheKey, resultData);
                setTimeout(() => elevationCache.delete(cacheKey), 3600000);

                results.push(resultData);
            });
        }

        res.json({ results });
    } catch (error) {
        console.error('Errore proxy elevation batch:', error);
        res.status(500).json({ error: 'Errore nel recupero delle elevazioni' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        cacheSize: elevationCache.size
    });
});

// Gestione errori 404
app.use((req, res) => {
    res.status(404).json({ error: 'Route non trovata' });
});

// Esporta l'app per i test
module.exports = app;

// Avvia il server solo se non siamo in ambiente di test
if (!process.env.VITEST) {
    app.listen(PORT, () => {
        console.log(`🚀 Server avviato su http://localhost:${PORT}`);
        console.log(`📁 Servizio file statici dalla directory: ${__dirname}`);
        console.log(`📍 Proxy elevation: http://localhost:${PORT}/api/elevation?lat=...&lng=...`);
        console.log(`📊 Cache elevation: ${elevationCache.size} elementi`);
    });
}