const express = require('express');
const router = express.Router();
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 3600 });

// Cost matrix caching
router.post('/matrix', async (req, res) => {
    try {
        const { points, mode } = req.body;

        if (!points || points.length < 2) {
            return res.status(400).json({ error: 'Almeno 2 punti richiesti' });
        }

        const cacheKey = JSON.stringify({ points, mode });
        const cached = cache.get(cacheKey);

        if (cached) {
            return res.json({ matrix: cached });
        }

        const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/${mode}/${coords}?annotations=duration`;

        const response = await axios.get(url);
        const matrix = response.data.durations;

        cache.set(cacheKey, matrix);
        res.json({ matrix });

    } catch (error) {
        console.error('Matrix error:', error);
        res.status(500).json({ error: 'Errore nel calcolo della matrice' });
    }
});

// Route calculation
router.post('/route', async (req, res) => {
    try {
        const { points, mode, order } = req.body;

        const orderedPoints = order.map(i => points[i]);
        const coords = orderedPoints.map(p => `${p.lng},${p.lat}`).join(';');

        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson`;

        const response = await axios.get(url);
        res.json(response.data);

    } catch (error) {
        console.error('Route error:', error);
        res.status(500).json({ error: 'Errore nel calcolo del percorso' });
    }
});

// Geocoding
router.post('/geocode', async (req, res) => {
    try {
        const { address } = req.body;

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'TSP-App/1.0' }
        });

        if (!response.data || response.data.length === 0) {
            return res.status(404).json({ error: 'Indirizzo non trovato' });
        }

        res.json({
            lat: parseFloat(response.data[0].lat),
            lng: parseFloat(response.data[0].lon)
        });

    } catch (error) {
        console.error('Geocode error:', error);
        res.status(500).json({ error: 'Errore nella geocodifica' });
    }
});

module.exports = router;