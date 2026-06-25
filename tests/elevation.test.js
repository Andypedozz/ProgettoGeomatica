import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoutePlanner } from '../app.js';

/**
 * Helper per creare un'istanza RoutePlanner senza chiamare il costruttore.
 */
function createPlanner() {
  const p = Object.create(RoutePlanner.prototype);
  p.elevationChart = null;
  return p;
}

/**
 * Estrae i valori numerici dalle statistiche nel DOM, supportando numeri negativi.
 */
function parseStats(html) {
  const valMatch = (label) => {
    const re = new RegExp(
      `<div class="value">([-\\d.]+)m</div>\\s*<div class="label">${label}</div>`,
    );
    const m = html.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  return {
    min: valMatch('Min'),
    max: valMatch('Max'),
    salita: valMatch('Salita'),
    discesa: valMatch('Discesa'),
    dislivello: valMatch('Dislivello'),
  };
}

/**
 * Estrae i labels (distanze) dal Chart, se creato.
 */
function getChartLabels() {
  if (!globalThis.Chart.mock.calls.length) return null;
  return globalThis.Chart.mock.calls[0][1].data.labels;
}

function getChartData() {
  if (!globalThis.Chart.mock.calls.length) return null;
  return globalThis.Chart.mock.calls[0][1].data.datasets[0].data;
}

// =====================================================================
// displayElevationProfile — statistiche
// =====================================================================
describe('displayElevationProfile() statistiche', () => {
  let planner;

  beforeEach(() => {
    planner = createPlanner();
    document.getElementById('elevationStats').innerHTML = '';
    vi.clearAllMocks();
  });

  it('calcola statistiche per profilo misto (salite e discese)', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100 },
        { distance: 10, elevation: 200 },
        { distance: 20, elevation: 150 },
        { distance: 30, elevation: 300 },
        { distance: 40, elevation: 250 },
      ],
      40000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.salita).toBe(250);  // (200-100)+(300-150)
    expect(s.discesa).toBe(100); // (200-150)+(300-250)
    expect(s.dislivello).toBe(200);
  });

  it('profilo costante: min=max, salita=0, discesa=0, dislivello=0', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 500 },
        { distance: 10, elevation: 500 },
        { distance: 20, elevation: 500 },
      ],
      20000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(500);
    expect(s.max).toBe(500);
    expect(s.salita).toBe(0);
    expect(s.discesa).toBe(0);
    expect(s.dislivello).toBe(0);
  });

  it('profilo solo salita: discesa=0', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 0 },
        { distance: 10, elevation: 100 },
        { distance: 20, elevation: 200 },
        { distance: 30, elevation: 300 },
      ],
      30000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(0);
    expect(s.max).toBe(300);
    expect(s.salita).toBe(300);
    expect(s.discesa).toBe(0);
    expect(s.dislivello).toBe(300);
  });

  it('profilo solo discesa: salita=0', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 300 },
        { distance: 10, elevation: 200 },
        { distance: 20, elevation: 100 },
        { distance: 30, elevation: 0 },
      ],
      30000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(0);
    expect(s.max).toBe(300);
    expect(s.salita).toBe(0);
    expect(s.discesa).toBe(300);
    expect(s.dislivello).toBe(300);
  });

  it('profilo con 1 solo punto: min=max, salita=0, discesa=0, dislivello=0', () => {
    planner.displayElevationProfile(
      [{ distance: 0, elevation: 250 }],
      10000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(250);
    expect(s.max).toBe(250);
    expect(s.salita).toBe(0);
    expect(s.discesa).toBe(0);
    expect(s.dislivello).toBe(0);
  });

  it('profilo con 2 punti: discesa netta', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 400 },
        { distance: 10, elevation: 150 },
      ],
      10000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(150);
    expect(s.max).toBe(400);
    expect(s.salita).toBe(0);
    expect(s.discesa).toBe(250);
    expect(s.dislivello).toBe(250);
  });

  it('quote negative (sotto il livello del mare)', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: -50 },
        { distance: 10, elevation: -20 },
        { distance: 20, elevation: -100 },
      ],
      20000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(-100);
    expect(s.max).toBe(-20);
    expect(s.salita).toBe(30);   // -20-(-50)=30
    expect(s.discesa).toBe(80);  // -20-(-100)=80
    expect(s.dislivello).toBe(80); // -20-(-100)=80
  });

  it('valori molto grandi di elevazione', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 8000 },
        { distance: 10, elevation: 8848 },
        { distance: 20, elevation: 5000 },
      ],
      20000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(5000);
    expect(s.max).toBe(8848);
    expect(s.salita).toBe(848);   // 8848-8000
    expect(s.discesa).toBe(3848); // 8848-5000
    expect(s.dislivello).toBe(3848);
  });

  it('zigzag alternato (su-giù-su-giù)', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100 },
        { distance: 5, elevation: 300 },
        { distance: 10, elevation: 100 },
        { distance: 15, elevation: 300 },
        { distance: 20, elevation: 100 },
      ],
      20000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.salita).toBe(400);  // (300-100)+(300-100)
    expect(s.discesa).toBe(400); // (300-100)+(300-100)
    expect(s.dislivello).toBe(200);
  });

  it('valori decimali nelle quote (arrotondati da Math.round)', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100.5 },
        { distance: 10, elevation: 200.7 },
        { distance: 20, elevation: 150.3 },
      ],
      20000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    // Math.round(100.5)=101, Math.round(200.7)=201
    expect(s.min).toBe(101);
    expect(s.max).toBe(201);
    // salita: Math.round(200.7-100.5) = Math.round(100.2) = 100
    expect(s.salita).toBe(100);
    // discesa: Math.round(200.7-150.3) = Math.round(50.4) = 50
    expect(s.discesa).toBe(50);
    // dislivello: Math.round(201-101) = 100
    expect(s.dislivello).toBe(100);
  });

  it('primo e ultimo punto alla stessa quota ma con variazioni intermedie', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 200 },
        { distance: 5, elevation: 300 },
        { distance: 10, elevation: 100 },
        { distance: 15, elevation: 200 },
      ],
      15000,
    );
    const s = parseStats(document.getElementById('elevationStats').innerHTML);
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.salita).toBe(200);  // (300-200)+(200-100)
    expect(s.discesa).toBe(200); // (300-100)+(...)
    expect(s.dislivello).toBe(200);
  });

  it('non fa nulla se elevations è null o vuoto', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    planner.displayElevationProfile(null, 40000);
    expect(document.getElementById('elevationStats').innerHTML).toBe('');

    planner.displayElevationProfile([], 40000);
    expect(document.getElementById('elevationStats').innerHTML).toBe('');

    spy.mockRestore();
  });
});

// =====================================================================
// displayElevationProfile — distanze progressive
// =====================================================================
describe('displayElevationProfile() distanze', () => {
  let planner;

  beforeEach(() => {
    planner = createPlanner();
    document.getElementById('elevationStats').innerHTML = '';
    vi.clearAllMocks();
  });

  it('distanze proporzionali alla posizione per 5 punti equidistanti', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100 },
        { distance: 10, elevation: 200 },
        { distance: 20, elevation: 150 },
        { distance: 30, elevation: 300 },
        { distance: 40, elevation: 250 },
      ],
      40000, // metri totali
    );
    const labels = getChartLabels();
    // 0/40 → 0.0, 10/40 → 10.0, 20/40 → 20.0, 30/40 → 30.0, 40/40 → 40.0 km
    expect(labels).toEqual(['0.0', '10.0', '20.0', '30.0', '40.0']);
  });

  it('distanze con totalDistanceKm=0 danno tutti 0.0', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100 },
        { distance: 10, elevation: 200 },
        { distance: 20, elevation: 150 },
      ],
      0,
    );
    const labels = getChartLabels();
    for (const lbl of labels) {
      expect(lbl).toBe('0.0');
    }
  });

  it('distanze con totalDistanceKm molto grande', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 0 },
        { distance: 1, elevation: 100 },
      ],
      1_000_000, // 1000 km
    );
    const labels = getChartLabels();
    // 0/1 → 0.0, 1/1 → 1000.0 km
    expect(labels[0]).toBe('0.0');
    expect(labels[1]).toBe('1000.0');
  });

  it('distanze con un solo punto: ultima distanza = 0.0', () => {
    planner.displayElevationProfile(
      [{ distance: 0, elevation: 500 }],
      50000,
    );
    const labels = getChartLabels();
    expect(labels).toEqual(['0.0']);
  });
});

// =====================================================================
// displayElevationProfile — grafico Chart.js
// =====================================================================
describe('displayElevationProfile() grafico', () => {
  let planner;

  beforeEach(() => {
    planner = createPlanner();
    document.getElementById('elevationStats').innerHTML = '';
    vi.clearAllMocks();
  });

  it('crea un Chart di tipo line con i dati corretti', () => {
    planner.displayElevationProfile(
      [
        { distance: 0, elevation: 100 },
        { distance: 10, elevation: 200 },
        { distance: 20, elevation: 150 },
      ],
      20000,
    );

    expect(globalThis.Chart).toHaveBeenCalledTimes(1);
    const opts = globalThis.Chart.mock.calls[0][1];
    expect(opts.type).toBe('line');
    expect(opts.data.datasets[0].data).toEqual([100, 200, 150]);
    expect(opts.data.datasets[0].borderColor).toBe('#22c55e');
    expect(opts.data.datasets[0].fill).toBe(true);
    expect(opts.data.datasets[0].pointRadius).toBe(0);
  });

  it('configura gli assi correttamente', () => {
    planner.displayElevationProfile(
      [{ distance: 0, elevation: 100 }, { distance: 10, elevation: 200 }],
      10000,
    );
    const opts = globalThis.Chart.mock.calls[0][1];
    expect(opts.options.scales.x.title.display).toBe(true);
    expect(opts.options.scales.x.title.text).toBe('Distanza (km)');
    expect(opts.options.scales.y.title.text).toBe('Altitudine (m)');
    expect(opts.options.scales.y.beginAtZero).toBe(false);
  });

  it('tooltip mostra altitudine in m slm', () => {
    planner.displayElevationProfile(
      [{ distance: 0, elevation: 100 }, { distance: 10, elevation: 200 }],
      10000,
    );
    const opts = globalThis.Chart.mock.calls[0][1];
    const labelCb = opts.options.plugins.tooltip.callbacks.label;
    expect(labelCb({ raw: 150 })).toBe('150 m slm');
  });

  it('legenda nascosta', () => {
    planner.displayElevationProfile(
      [{ distance: 0, elevation: 100 }, { distance: 10, elevation: 200 }],
      10000,
    );
    const opts = globalThis.Chart.mock.calls[0][1];
    expect(opts.options.plugins.legend.display).toBe(false);
  });

  it('distrugge il grafico precedente prima di crearne uno nuovo', () => {
    const destroyMock = vi.fn();
    globalThis.Chart = vi.fn(function () {
      return { destroy: destroyMock };
    });

    planner.displayElevationProfile(
      [{ distance: 0, elevation: 100 }], 10000,
    );
    expect(destroyMock).not.toHaveBeenCalled();

    planner.displayElevationProfile(
      [{ distance: 0, elevation: 200 }], 10000,
    );
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it('non crea Chart se elevations è null', () => {
    planner.displayElevationProfile(null, 10000);
    expect(globalThis.Chart).not.toHaveBeenCalled();
  });

  it('non crea Chart se elevations è []', () => {
    planner.displayElevationProfile([], 10000);
    expect(globalThis.Chart).not.toHaveBeenCalled();
  });
});
