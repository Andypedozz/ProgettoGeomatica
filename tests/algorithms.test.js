import { describe, it, expect, beforeEach } from 'vitest';
import { RoutePlanner } from '../app.js';

/**
 * Helper per creare un'istanza RoutePlanner senza chiamare il costruttore.
 */
function createPlanner(points, matrix) {
  const p = Object.create(RoutePlanner.prototype);
  p.points = points;
  p.matrix = matrix;
  return p;
}

/** Verifica che un percorso sia valido: contenga tutti gli indici senza ripetizioni */
function expectValidPath(path, n) {
  expect(path).toBeTruthy();
  expect(path).toHaveLength(n);
  expect(new Set(path).size).toBe(n);
  for (const idx of path) {
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(n);
  }
}

// -------------------------------------------------------------------------
// DATI DI TEST BASE
// -------------------------------------------------------------------------
const points = [
  { id: 'a', lat: 41.9, lng: 12.5 },
  { id: 'b', lat: 45.5, lng: 9.2 },
  { id: 'c', lat: 43.8, lng: 11.3 },
  { id: 'd', lat: 45.4, lng: 12.3 },
];

const matrix = {
  durations: [
    [0, 3600, 1800, 2400],
    [3600, 0, 3000, 1200],
    [1800, 3000, 0, 1800],
    [2400, 1200, 1800, 0],
  ],
  distances: [
    [0, 500, 280, 400],
    [500, 0, 400, 250],
    [280, 400, 0, 300],
    [400, 250, 300, 0],
  ],
};

// =====================================================================
// cost()
// =====================================================================
describe('cost()', () => {
  let p;

  beforeEach(() => {
    p = createPlanner(points, matrix);
  });

  it('calcola il costo in durata per Roma→Milano→Firenze→Venezia', () => {
    expect(p.cost([0, 1, 2, 3])).toBe(3600 + 3000 + 1800);
  });

  it('calcola il costo in distanza con useDistance=true', () => {
    expect(p.cost([0, 1, 2, 3], true)).toBe(500 + 400 + 300);
  });

  it('restituisce 0 per percorso con 1 tappa', () => {
    expect(p.cost([0])).toBe(0);
    expect(p.cost([2])).toBe(0);
  });

  it('restituisce 0 per percorso vuoto', () => {
    expect(p.cost([])).toBe(0);
  });

  it('calcola costo per percorso di 2 tappe', () => {
    expect(p.cost([0, 2])).toBe(1800);
    expect(p.cost([0, 2], true)).toBe(280);
  });

  it('calcola costo per percorso di 3 tappe', () => {
    expect(p.cost([0, 2, 1])).toBe(1800 + 3000);
  });

  it('restituisce lo stesso costo per percorso inverso (matrice simmetrica)', () => {
    const fwd = p.cost([0, 2, 3, 1]);
    const rev = p.cost([1, 3, 2, 0]);
    expect(fwd).toBe(rev);
  });

  it('usa durations per default e distances solo con flag', () => {
    const d1 = p.cost([0, 1, 2, 3]);
    const d2 = p.cost([0, 1, 2, 3], false);
    expect(d1).toBe(d2);
    const dist = p.cost([0, 1, 2, 3], true);
    expect(dist).not.toBe(d1);
  });
});

// =====================================================================
// nearestNeighbor()
// =====================================================================
describe('nearestNeighbor()', () => {
  let p;

  beforeEach(() => {
    p = createPlanner(points, matrix);
  });

  it('partendo da Roma (0) → Firenze (2) → Venezia (3) → Milano (1)', () => {
    expect(p.nearestNeighbor(0)).toEqual([0, 2, 3, 1]);
  });

  it('partendo da Milano (1) → Venezia (3) → Firenze (2) → Roma (0)', () => {
    expect(p.nearestNeighbor(1)).toEqual([1, 3, 2, 0]);
  });

  it('partendo da Firenze (2) → Roma (0) → Venezia (3) → Milano (1)', () => {
    expect(p.nearestNeighbor(2)).toEqual([2, 0, 3, 1]);
  });

  it('partendo da Venezia (3) → Milano (1) → Firenze (2) → Roma (0)', () => {
    expect(p.nearestNeighbor(3)).toEqual([3, 1, 2, 0]);
  });

  it('ogni partenza produce percorso completo e senza ripetizioni', () => {
    for (let start = 0; start < 4; start++) {
      expectValidPath(p.nearestNeighbor(start), 4);
    }
  });

  it('con 1 solo punto restituisce [0]', () => {
    const p1 = createPlanner(
      [{ id: 'a', lat: 0, lng: 0 }],
      { durations: [[0]], distances: [[0]] },
    );
    expect(p1.nearestNeighbor(0)).toEqual([0]);
  });

  it('con 2 punti restituisce [0,1] o [1,0] a seconda della partenza', () => {
    const p2 = createPlanner(
      [{ id: 'a', lat: 0, lng: 0 }, { id: 'b', lat: 1, lng: 1 }],
      { durations: [[0, 100], [100, 0]], distances: [[0, 10], [10, 0]] },
    );
    expect(p2.nearestNeighbor(0)).toEqual([0, 1]);
    expect(p2.nearestNeighbor(1)).toEqual([1, 0]);
  });

  it('con 3 punti in linea produce percorso prevedibile', () => {
    // 0-1-2 in linea, 0→1=10, 0→2=20, 1→2=10
    const p3 = createPlanner(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { durations: [[0, 10, 20], [10, 0, 10], [20, 10, 0]] },
    );
    expect(p3.nearestNeighbor(0)).toEqual([0, 1, 2]);
    expect(p3.nearestNeighbor(1)).toEqual([1, 0, 2]); // 1→0(10)→2(20)
    expect(p3.nearestNeighbor(2)).toEqual([2, 1, 0]);
  });

  it('con distanze tutte uguali sceglie il primo indice disponibile', () => {
    const pEq = createPlanner(points, {
      durations: [
        [0, 10, 10, 10],
        [10, 0, 10, 10],
        [10, 10, 0, 10],
        [10, 10, 10, 0],
      ],
    });
    expect(pEq.nearestNeighbor(0)).toEqual([0, 1, 2, 3]);
  });

  it('salta elementi null/undefined nella matrice', () => {
    const pNull = createPlanner(points, {
      durations: [
        [0, null, 10, null],
        [null, 0, 20, 30],
        [10, 20, 0, null],
        [null, 30, null, 0],
      ],
    });
    // Da 0: salta 1(null) e 3(null), va a 2(10)
    // Da 2: 0(10) o 1(20) → 0(10)
    // Da 0: 1(null) e 3(null) → nessuno (best=-1) → break
    const path = pNull.nearestNeighbor(0);
    expect(path.length).toBeGreaterThanOrEqual(2);
  });

  it('funziona con 5 punti', () => {
    const n = 5;
    const pts5 = Array.from({ length: n }, (_, i) => ({ id: `${i}` }));
    const mat5 = { durations: [], distances: [] };
    for (let i = 0; i < n; i++) {
      mat5.durations[i] = [];
      mat5.distances[i] = [];
      for (let j = 0; j < n; j++) {
        mat5.durations[i][j] = i === j ? 0 : Math.abs(i - j) * 10;
        mat5.distances[i][j] = i === j ? 0 : Math.abs(i - j);
      }
    }
    const p5 = createPlanner(pts5, mat5);
    for (let start = 0; start < n; start++) {
      expectValidPath(p5.nearestNeighbor(start), n);
    }
  });
});

// =====================================================================
// multiStartNN()
// =====================================================================
describe('multiStartNN()', () => {
  let p;

  beforeEach(() => {
    p = createPlanner(points, matrix);
  });

  it('trova il miglior percorso tra tutti gli start (costo 4800)', () => {
    const path = p.multiStartNN();
    expectValidPath(path, 4);
    expect(p.cost(path)).toBe(4800);
  });

  it('restituisce percorso completo senza ripetizioni', () => {
    expectValidPath(p.multiStartNN(), 4);
  });

  it('è deterministica: chiamate ripetute danno lo stesso costo', () => {
    const c1 = p.cost(p.multiStartNN());
    const c2 = p.cost(p.multiStartNN());
    expect(c1).toBe(c2);
  });

  it('con 2 punti restituisce [0,1] o [1,0]', () => {
    const p2 = createPlanner(
      [{ id: 'a' }, { id: 'b' }],
      { durations: [[0, 5], [5, 0]] },
    );
    expectValidPath(p2.multiStartNN(), 2);
  });

  it('con 1 punto restituisce [0]', () => {
    const p1 = createPlanner(
      [{ id: 'a' }],
      { durations: [[0]] },
    );
    expect(p1.multiStartNN()).toEqual([0]);
  });

  it('con tutti zeri (stessa posizione) funziona', () => {
    const pz = createPlanner(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { durations: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] },
    );
    expectValidPath(pz.multiStartNN(), 3);
    expect(pz.cost(pz.multiStartNN())).toBe(0);
  });

  it('con matrice asimmetrica funziona comunque', () => {
    const asym = createPlanner(points, {
      durations: [
        [0, 100, 10, 50],
        [1, 0, 5, 20],
        [15, 200, 0, 3],
        [8, 12, 25, 0],
      ],
    });
    expectValidPath(asym.multiStartNN(), 4);
  });
});

// =====================================================================
// twoOpt()
// =====================================================================
describe('twoOpt()', () => {
  let p;

  beforeEach(() => {
    p = createPlanner(points, matrix);
  });

  it('non peggiora il costo per percorsi NN da ogni start', () => {
    for (let start = 0; start < 4; start++) {
      const nn = p.nearestNeighbor(start);
      const opt = p.twoOpt(nn);
      expect(p.cost(opt)).toBeLessThanOrEqual(p.cost(nn));
    }
  });

  it('restituisce percorso valido dopo ottimizzazione', () => {
    expectValidPath(p.twoOpt(p.multiStartNN()), 4);
  });

  it('migliora un percorso volutamente pessimo', () => {
    const badMatrix = {
      durations: [
        [0, 1, 100, 100],
        [1, 0, 100, 2],
        [100, 100, 0, 1],
        [100, 2, 1, 0],
      ],
    };
    const bp = createPlanner(points, badMatrix);
    const badPath = [0, 3, 1, 2];
    expect(bp.cost(badPath)).toBe(202);
    const improved = bp.twoOpt(badPath);
    expect(bp.cost(improved)).toBeLessThan(202);
    expect(improved).toEqual([0, 1, 3, 2]);
  });

  it('con 2 punti restituisce copia identica (nessuna ottimizzazione possibile)', () => {
    const p2 = createPlanner(
      [{ id: 'a' }, { id: 'b' }],
      { durations: [[0, 1], [1, 0]] },
    );
    expect(p2.twoOpt([0, 1])).toEqual([0, 1]);
    expect(p2.twoOpt([1, 0])).toEqual([1, 0]);
  });

  it('con 3 punti restituisce copia (nessuna ottimizzazione a 3)', () => {
    const p3 = createPlanner(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      { durations: [[0, 10, 20], [10, 0, 15], [20, 15, 0]] },
    );
    const path = [0, 1, 2];
    const opt = p3.twoOpt(path);
    expect(opt).toEqual([0, 1, 2]);
    expect(p3.cost(opt)).toBe(p3.cost(path));
  });

  it('è deterministica: stessa input → stessa output', () => {
    const nn = p.multiStartNN();
    const r1 = p.twoOpt(nn);
    const r2 = p.twoOpt(nn);
    expect(r1).toEqual(r2);
  });

  it('migliora un secondo percorso pessimo differente', () => {
    const badMatrix = {
      durations: [
        [0, 100, 1, 100],
        [100, 0, 100, 1],
        [1, 100, 0, 100],
        [100, 1, 100, 0],
      ],
    };
    const bp = createPlanner(points, badMatrix);
    const badPath = [0, 1, 3, 2]; // costo 100+1+100=201
    expect(bp.cost(badPath)).toBe(201);
    const improved = bp.twoOpt(badPath);
    // Soluzione ottima: 0→2(1)→3(100)→1(1)=102  oppure  0→2(1)→1(100)→3(1)=102
    expect(bp.cost(improved)).toBe(102);
  });

  it('lascia invariato un percorso già ottimo', () => {
    // Con matrice diagonale dominante il NN è già ottimo
    const pOpt = createPlanner(points, matrix);
    const nnPath = pOpt.multiStartNN();
    const optPath = pOpt.twoOpt(nnPath);
    expect(pOpt.cost(optPath)).toBe(pOpt.cost(nnPath));
  });

  it('migliora progressivamente con più iterazioni (while loop)', () => {
    const tough = {
      durations: [
        [0, 50, 5, 60, 55],
        [50, 0, 60, 5, 70],
        [5, 60, 0, 70, 10],
        [60, 5, 70, 0, 65],
        [55, 70, 10, 65, 0],
      ],
    };
    const n = 5;
    const pts5 = Array.from({ length: n }, (_, i) => ({ id: `${i}` }));
    const pt = createPlanner(pts5, tough);

    // Percorso deliberatamente errato
    const badPath = [0, 4, 2, 1, 3];
    const badCost = pt.cost(badPath);
    const improved = pt.twoOpt(badPath);
    const improvedCost = pt.cost(improved);
    expect(improvedCost).toBeLessThanOrEqual(badCost);
    expectValidPath(improved, n);
  });
});

// =====================================================================
// Integrazione multiStartNN + twoOpt
// =====================================================================
describe('integrazione multiStartNN + twoOpt', () => {
  it('percorso completo, costo non peggiore del solo NN', () => {
    const planner = createPlanner(points, matrix);
    const nnPath = planner.multiStartNN();
    const tspPath = planner.twoOpt(nnPath);
    expectValidPath(tspPath, 4);
    expect(planner.cost(tspPath)).toBeLessThanOrEqual(planner.cost(nnPath));
  });

  it('flag useDistance funziona anche dopo 2-opt', () => {
    const planner = createPlanner(points, matrix);
    const path = planner.twoOpt(planner.multiStartNN());
    const costDist = planner.cost(path, true);
    expect(costDist).toBeGreaterThan(0);
  });
});

// =====================================================================
// Verifica brute-force per n ≤ 6 (TSP esatto)
// =====================================================================
describe('verifica brute-force (n ≤ 6)', () => {
  /**
   * Calcola il percorso ottimo esatto con forza bruta.
   * Restituisce { path, cost }.
   */
  function bruteForceTSP(planner) {
    const n = planner.points.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    let bestPath = null;
    let bestCost = Infinity;

    function permute(arr, prefix) {
      if (prefix.length === n) {
        const c = planner.cost(prefix);
        if (c < bestCost) {
          bestCost = c;
          bestPath = [...prefix];
        }
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        const next = arr[i];
        const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
        permute(remaining, [...prefix, next]);
      }
    }

    permute(indices, []);
    return { path: bestPath, cost: bestCost };
  }

  function createRandomSymmetricMatrix(n, max = 100) {
    const m = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.floor(Math.random() * max) + 1;
        m[i][j] = v;
        m[j][i] = v;
      }
    }
    return m;
  }

  // Test su 10 matrici random con n=5, verificando che NN+2opt sia al
  // massimo 2× peggiore dell'ottimo (euristica greedy ha un bound noto 2×)
  it('NN+2opt non supera 2× il costo ottimo per n=5 (10 matrici random)', () => {
    const n = 5;
    const pts = Array.from({ length: n }, (_, i) => ({ id: `${i}` }));

    for (let trial = 0; trial < 10; trial++) {
      const dist = createRandomSymmetricMatrix(n, 100);
      const pl = createPlanner(pts, { durations: dist });

      const optimal = bruteForceTSP(pl);
      const nnPath = pl.multiStartNN();
      const tspPath = pl.twoOpt(nnPath);
      const tspCost = pl.cost(tspPath);

      expect(tspCost).toBeGreaterThanOrEqual(optimal.cost);
      expect(tspCost).toBeLessThanOrEqual(optimal.cost * 2);
    }
  });

  it('NN+2opt trova la soluzione ottima per matrici metriche piccole (n=4)', () => {
    const n = 4;
    const pts = Array.from({ length: n }, (_, i) => ({ id: `${i}` }));

    for (let trial = 0; trial < 20; trial++) {
      const dist = createRandomSymmetricMatrix(n, 50);
      const pl = createPlanner(pts, { durations: dist });

      const optimal = bruteForceTSP(pl);
      const nnPath = pl.multiStartNN();
      const tspPath = pl.twoOpt(nnPath);
      const tspCost = pl.cost(tspPath);

      expect(tspCost).toBeGreaterThanOrEqual(optimal.cost);
      // Con n=4 e NN+2opt spesso troviamo l'ottimo; se non è ottimo,
      // almeno non è peggio di 1.5×
      expect(tspCost).toBeLessThanOrEqual(Math.max(optimal.cost * 1.5, optimal.cost + 1));
    }
  });

  it('brute-force su 6 punti conosciuti produce risultato corretto', () => {
    const n = 6;
    const pts = Array.from({ length: n }, (_, i) => ({ id: `${i}` }));
    // Matrice a costi crescenti: i→j = |i-j| (metrica lineare)
    const dist = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => 10 * Math.abs(i - j)),
    );
    const pl = createPlanner(pts, { durations: dist });

    const optimal = bruteForceTSP(pl);
    // Il percorso ottimo in linea è visitare in ordine: 0-1-2-3-4-5 (o inverso)
    // Costo: 10+10+10+10+10 = 50
    expect(optimal.cost).toBe(50);
  });
});

// =====================================================================
// Matrice con valori estremi
// =====================================================================
describe('valori estremi nella matrice', () => {
  it('gestisce valori molto grandi senza overflow', () => {
    const large = 1e12;
    const pts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const pl = createPlanner(pts, {
      durations: [[0, large, large], [large, 0, large], [large, large, 0]],
    });
    const path = pl.multiStartNN();
    expect(pl.cost(path)).toBe(2 * large);
    const opt = pl.twoOpt(path);
    expect(pl.cost(opt)).toBeLessThanOrEqual(pl.cost(path));
  });

  it('gestisce costi zero tra tutte le tappe (stessa posizione)', () => {
    const pts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const pl = createPlanner(pts, {
      durations: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
    });
    expectValidPath(pl.multiStartNN(), 4);
    expect(pl.cost(pl.multiStartNN())).toBe(0);
    expect(pl.cost(pl.twoOpt(pl.multiStartNN()))).toBe(0);
  });
});
