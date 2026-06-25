import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock Leaflet (L) — necessario per il costruttore di RoutePlanner
// ---------------------------------------------------------------------------
function createMockMap() {
  const map = {
    setView: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    removeLayer: vi.fn().mockReturnThis(),
    fitBounds: vi.fn().mockReturnThis(),
    addLayer: vi.fn().mockReturnThis(),
    getBounds: vi.fn(() => ({})),
  };
  return map;
}

globalThis.L = {
  map: vi.fn(createMockMap),
  tileLayer: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
  marker: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    getLatLng: vi.fn(() => ({ lat: 0, lng: 0 })),
  })),
  geoJSON: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    getBounds: vi.fn(() => ({})),
  })),
  divIcon: vi.fn(() => ({})),
};

// ---------------------------------------------------------------------------
// 2. Mock Chart.js
// ---------------------------------------------------------------------------
globalThis.Chart = vi.fn(function () {
  return { destroy: vi.fn() };
});

// ---------------------------------------------------------------------------
// 3. Allestisci un DOM minimo per RoutePlanner
// ---------------------------------------------------------------------------
document.body.innerHTML = `
  <div id="map"></div>
  <div id="list"></div>
  <div id="results"></div>
  <div id="elevationPanel" class="collapsed"></div>
  <canvas id="elevationChart"></canvas>
  <div id="elevationStats"></div>
  <div id="elevationToggle"></div>
  <div id="stopCount"></div>
  <div id="loadingOverlay"></div>
  <div id="themeIcon"></div>
  <div id="themeText"></div>
  <input id="addr" value="" />
  <select id="mode">
    <option value="driving">Auto</option>
    <option value="walking">Piedi</option>
  </select>
  <select id="algo">
    <option value="nn">Nearest Neighbor</option>
    <option value="twoopt">2-Opt</option>
  </select>
`;

// Mock getContext per il canvas usato da Chart.js
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));

// ---------------------------------------------------------------------------
// 4. Mock fetch globale (usato sia dal client che dal server)
// ---------------------------------------------------------------------------
globalThis.fetch = vi.fn();

// ---------------------------------------------------------------------------
// 5. Importa app.js per registrare RoutePlanner nel global scope
//    L'instanziazione automatica è protetta dal ramo `else` (solo browser)
// ---------------------------------------------------------------------------
await import('./app.js');
