// ============================
// TRAVELING SALESMAN PROBLEM
// Node.js CLI Example
// ============================

// 🗺️ GRAFO (distanze simulate)
const graph = {
  Urbino: { Pesaro: 40, Ancona: 90, Rimini: 70, Bologna: 140 },
  Pesaro: { Urbino: 40, Ancona: 80, Rimini: 30, Bologna: 130 },
  Ancona: { Urbino: 90, Pesaro: 80, Rimini: 100, Bologna: 200 },
  Rimini: { Urbino: 70, Pesaro: 30, Ancona: 100, Bologna: 120 },
  Bologna: { Urbino: 140, Pesaro: 130, Ancona: 200, Rimini: 120 }
};

const nodes = Object.keys(graph);

// ============================
// UTILS
// ============================

function permute(arr) {
  if (arr.length <= 1) return [arr];
  let result = [];

  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));

    for (let p of permute(rest)) {
      result.push([current, ...p]);
    }
  }

  return result;
}

function calculateCost(path) {
  let cost = 0;

  for (let i = 0; i < path.length - 1; i++) {
    cost += graph[path[i]][path[i + 1]];
  }

  // ritorno al punto iniziale
  cost += graph[path[path.length - 1]][path[0]];

  return cost;
}

// ============================
// 1️⃣ BRUTE FORCE (esatto)
// ============================

function bruteForceTSP() {
  const perms = permute(nodes);

  let bestPath = null;
  let bestCost = Infinity;

  for (let p of perms) {
    const cost = calculateCost(p);

    if (cost < bestCost) {
      bestCost = cost;
      bestPath = p;
    }
  }

  return { bestPath, bestCost };
}

// ============================
// 2️⃣ NEAREST NEIGHBOR (greedy)
// ============================

function nearestNeighbor(start) {
  let visited = new Set([start]);
  let path = [start];
  let current = start;

  while (visited.size < nodes.length) {
    let next = null;
    let minDist = Infinity;

    for (let neighbor in graph[current]) {
      if (!visited.has(neighbor) && graph[current][neighbor] < minDist) {
        minDist = graph[current][neighbor];
        next = neighbor;
      }
    }

    visited.add(next);
    path.push(next);
    current = next;
  }

  return {
    path: [...path, start],
    cost: calculateCost(path)
  };
}

// ============================
// 3️⃣ MAIN EXECUTION
// ============================

function run() {
  console.log("\n==============================");
  console.log("🚀 TRAVELING SALESMAN PROBLEM");
  console.log("==============================\n");

  console.log("📍 Nodi:", nodes.join(", "));
  console.log("\n⏳ Calcolo in corso...\n");

  // GREEDY
  const greedy = nearestNeighbor(nodes[0]);

  console.log("🟡 NEAREST NEIGHBOR (euristico)");
  console.log("Percorso:", greedy.path.join(" → "));
  console.log("Costo:", greedy.cost);
  console.log("\n------------------------------\n");

  // BRUTE FORCE (può essere lento ma qui piccolo grafo ok)
  const brute = bruteForceTSP();

  console.log("🔴 BRUTE FORCE (ottimo assoluto)");
  console.log("Percorso:", brute.bestPath.join(" → "));
  console.log("Costo:", brute.bestCost);

  console.log("\n==============================\n");
}

run();