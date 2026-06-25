import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';

// globalThis.fetch è già mockato in test-setup.js e server.js lo usa
import app from '../server.js';

function mockFetchResponse(data) {
  fetch.mockResolvedValue({
    json: vi.fn().mockResolvedValue(data),
    ok: true,
  });
}

beforeEach(() => {
  fetch.mockClear();
});

// =====================================================================
// GET /health
// =====================================================================
describe('GET /health', () => {
  it('restituisce 200 con status OK, timestamp e cacheSize', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('cacheSize');
  });
});

// =====================================================================
// GET /api/elevation — singolo punto
// =====================================================================
describe('GET /api/elevation', () => {
  // --- Validazione ---
  it('400: lat e lng mancanti', async () => {
    const res = await request(app).get('/api/elevation');
    expect(res.status).toBe(400);
  });

  it('400: solo lat presente', async () => {
    const res = await request(app).get('/api/elevation?lat=45.0');
    expect(res.status).toBe(400);
  });

  it('400: solo lng presente', async () => {
    const res = await request(app).get('/api/elevation?lng=12.0');
    expect(res.status).toBe(400);
  });

  it('400: lat è stringa vuota', async () => {
    const res = await request(app).get('/api/elevation?lat=&lng=12.0');
    expect(res.status).toBe(400);
  });

  it('400: lng è stringa vuota', async () => {
    const res = await request(app).get('/api/elevation?lat=45.0&lng=');
    expect(res.status).toBe(400);
  });

  it('400: lat non numerico', async () => {
    const res = await request(app).get('/api/elevation?lat=abc&lng=12.0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('lat e lng devono essere numeri validi');
  });

  it('400: lng non numerico', async () => {
    const res = await request(app).get('/api/elevation?lat=45.0&lng=xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('lat e lng devono essere numeri validi');
  });

  // --- Proxy ---
  it('200: recupera e restituisce dati da open-elevation (mock)', async () => {
    mockFetchResponse({
      results: [{ latitude: 45.0, longitude: 12.0, elevation: 100 }],
    });
    const res = await request(app).get('/api/elevation?lat=45.0&lng=12.0');
    expect(res.status).toBe(200);
    expect(res.body.results[0].elevation).toBe(100);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('api.open-elevation.com'),
    );
  });

  it('200: coordinate con decimali e segno negativo', async () => {
    mockFetchResponse({
      results: [{ latitude: -33.86, longitude: 151.21, elevation: 5 }],
    });
    const res = await request(app).get('/api/elevation?lat=-33.86&lng=151.21');
    expect(res.status).toBe(200);
    expect(res.body.results[0].elevation).toBe(5);
  });

  it('200: coordinate equatoriali (lat=0, lng=0)', async () => {
    mockFetchResponse({
      results: [{ latitude: 0, longitude: 0, elevation: 0 }],
    });
    const res = await request(app).get('/api/elevation?lat=0&lng=0');
    expect(res.status).toBe(200);
  });

  // --- Cache ---
  it('200: seconda richiesta con stesse coordinate usa la cache', async () => {
    const data = { results: [{ latitude: 47.0, longitude: 11.0, elevation: 500 }] };
    mockFetchResponse(data);

    await request(app).get('/api/elevation?lat=47.0&lng=11.0');
    expect(fetch).toHaveBeenCalledTimes(1);

    await request(app).get('/api/elevation?lat=47.0&lng=11.0');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('200: coordinate diverse non condividono la cache', async () => {
    const dataA = { results: [{ latitude: 40.0, longitude: 10.0, elevation: 200 }] };
    const dataB = { results: [{ latitude: 41.0, longitude: 11.0, elevation: 300 }] };

    mockFetchResponse(dataA);
    await request(app).get('/api/elevation?lat=40.0&lng=10.0');
    expect(fetch).toHaveBeenCalledTimes(1);

    mockFetchResponse(dataB);
    await request(app).get('/api/elevation?lat=41.0&lng=11.0');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// =====================================================================
// POST /api/elevation/batch
// =====================================================================
describe('POST /api/elevation/batch', () => {
  // --- Validazione ---
  it('400: body senza locations', async () => {
    const res = await request(app).post('/api/elevation/batch').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('locations array è richiesto');
  });

  it('400: locations non è un array', async () => {
    const res = await request(app)
      .post('/api/elevation/batch')
      .send({ locations: 'string' });
    expect(res.status).toBe(400);
  });

  it('400: array vuoto (0 locations)', async () => {
    const res = await request(app)
      .post('/api/elevation/batch')
      .send({ locations: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('locations array è richiesto');
  });

    it('400: più di 50 location', async () => {
      const locations = Array.from({ length: 51 }, (_, i) => ({
        lat: 70 + i * 0.01,
        lng: 70 + i * 0.01,
      }));
      const res = await request(app)
        .post('/api/elevation/batch')
        .send({ locations });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Massimo 50');
    });

  it('200: esattamente 50 location è accettato', async () => {
    // Coordinate uniche mai usate prima per evitare cache collision
    const locs = Array.from({ length: 50 }, (_, i) => ({
      lat: 60 + i * 0.01,
      lng: 60 + i * 0.01,
    }));
    mockFetchResponse({ results: locs.map((_, i) => ({
      latitude: 60 + i * 0.01,
      longitude: 60 + i * 0.01,
      elevation: i * 10,
    })) });
    const res = await request(app)
      .post('/api/elevation/batch')
      .send({ locations: locs });
    expect(res.status).toBe(200);
  });

  // --- Proxy ---
  it('200: restituisce elevazioni per 2 location', async () => {
    // Coordinate uniche mai usate prima per evitare cache collision
    mockFetchResponse({
      results: [
        { latitude: 10.0, longitude: 20.0, elevation: 100 },
        { latitude: 11.0, longitude: 21.0, elevation: 200 },
      ],
    });
    const res = await request(app)
      .post('/api/elevation/batch')
      .send({
        locations: [
          { lat: 10.0, lng: 20.0 },
          { lat: 11.0, lng: 21.0 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].results[0].elevation).toBe(100);
    expect(res.body.results[1].results[0].elevation).toBe(200);
  });

  it('200: coordinate negative (emisfero sud)', async () => {
    mockFetchResponse({
      results: [
        { latitude: -33.86, longitude: 151.21, elevation: 5 },
      ],
    });
    const res = await request(app)
      .post('/api/elevation/batch')
      .send({ locations: [{ lat: -33.86, lng: 151.21 }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0].results[0].elevation).toBe(5);
  });

  // --- Cache batch ---
  it('200: batch già in cache non chiama fetch', async () => {
    const data = { results: [{ latitude: 88.0, longitude: 44.0, elevation: 300 }] };
    mockFetchResponse(data);

    // Prima richiesta (batch)
    await request(app)
      .post('/api/elevation/batch')
      .send({ locations: [{ lat: 88.0, lng: 44.0 }] });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Seconda richiesta (singola, stesse coordinate) — dovrebbe usare la cache
    await request(app).get('/api/elevation?lat=88.0&lng=44.0');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('200: singola richiesta popola cache usata dal batch successivo', async () => {
    const data = { results: [{ latitude: 99.0, longitude: 55.0, elevation: 400 }] };
    mockFetchResponse(data);

    // Singola richiesta
    await request(app).get('/api/elevation?lat=99.0&lng=55.0');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Batch con stesse coordinate — cache hit, fetch non chiamato
    await request(app)
      .post('/api/elevation/batch')
      .send({ locations: [{ lat: 99.0, lng: 55.0 }] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// 404
// =====================================================================
describe('404', () => {
  it('GET route sconosciuta', async () => {
    const res = await request(app).get('/rotta-inesistente');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Route non trovata');
  });

  it('POST route sconosciuta', async () => {
    const res = await request(app).post('/rotta-inesistente');
    expect(res.status).toBe(404);
  });

  it('PUT route sconosciuta', async () => {
    const res = await request(app).put('/api/elevation');
    expect(res.status).toBe(404);
  });
});
