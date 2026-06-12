/**
 * Classe principale RoutePlanner
 * Gestisce tutte le funzionalità dell'applicazione di ottimizzazione percorsi
 * - Mappa interattiva con Leaflet
 * - Gestione tappe (aggiunta, rimozione, modifica)
 * - Calcolo percorso ottimale con algoritmi TSP
 * - Profilo altimetrico con Chart.js
 * - Tema chiaro/scuro
 */
class RoutePlanner {

    /**
     * Costruttore: inizializza la mappa, le variabili e gli eventi
     */
    constructor() {
        // Inizializzazione della mappa Leaflet
        // Centro Italia (43.7, 12.6) con zoom livello 6
        this.map = L.map('map').setView([43.7, 12.6], 6);

        // Aggiunta del layer delle piastrelle OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors', // Attribuzione richiesta da OSM
            maxZoom: 19
        }).addTo(this.map);

        // Array delle tappe (punti da visitare)
        this.points = [];           // { id, lat, lng }
        this.markers = [];          // Riferimenti ai marker Leaflet { id, marker }
        this.matrix = null;         // Matrice delle distanze/tempi tra le tappe
        this.cache = new Map();     // Cache per matrici già calcolate

        // Rate limiting per Nominatim (1 richiesta al secondo)
        this.lastNominatim = 0;     // Timestamp ultima geocodifica

        // Layer della route tracciata sulla mappa
        this.routeLayer = null;     // Layer del percorso disegnato

        // Riferimento al grafico altimetrico Chart.js
        this.elevationChart = null;

        // Stato del pannello altimetrico (collassato/espanso)
        this.panelCollapsed = true;

        // Tema corrente (false = light, true = dark)
        this.isDark = false;

        // Imposta tema light come predefinito
        document.body.classList.remove('dark');

        // Evento click sulla mappa: aggiunge una tappa alla posizione cliccata
        this.map.on('click', e => {
            this.addPoint(e.latlng.lat, e.latlng.lng);
        });

        // Aggiorna l'interfaccia del tema (icone e testi)
        this.updateThemeUI();
    }

    /**
     * Mostra overlay di caricamento
     */
    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }

    /**
     * Nasconde overlay di caricamento
     */
    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    /**
     * Alterna tra tema chiaro e scuro
     */
    toggleTheme() {
        this.isDark = !this.isDark;
        if (this.isDark) {
            document.body.classList.add('dark');   // Aggiunge classe dark al body
        } else {
            document.body.classList.remove('dark'); // Rimuove classe dark
        }
        this.updateThemeUI(); // Aggiorna icone e testi
    }

    /**
     * Aggiorna l'interfaccia del toggle tema (icona e testo)
     */
    updateThemeUI() {
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if (this.isDark) {
            icon.textContent = '☀️';   // Sole per tema scuro (passa a light)
            text.textContent = 'Light';
        } else {
            icon.textContent = '🌙';   // Luna per tema chiaro (passa a dark)
            text.textContent = 'Dark';
        }
    }

    /**
     * Espande/collassa il pannello del profilo altimetrico
     * Applica trasformazione CSS translateY
     */
    toggleElevationPanel() {
        this.panelCollapsed = !this.panelCollapsed;
        const panel = document.getElementById('elevationPanel');
        const btn = document.getElementById('elevationToggle');

        if (this.panelCollapsed) {
            panel.classList.add('collapsed');  // Nasconde il pannello (mostra solo header)
            btn.textContent = '▲';             // Freccia su = espandi
        } else {
            panel.classList.remove('collapsed'); // Mostra il pannello completo
            btn.textContent = '▼';               // Freccia giù = collassa
        }
    }

    /**
     * Genera un ID univoco per ogni tappa
     * @returns {string} ID randomico
     */
    uid() {
        // Math.random() -> numero casuale
        // toString(36) -> converte in base36 (lettere + numeri)
        // slice(2) -> rimuove '0.' iniziale
        return Math.random().toString(36).slice(2);
    }

    /**
     * Aggiunge una nuova tappa alla mappa e alla lista
     * @param {number} lat - Latitudine
     * @param {number} lng - Longitudine
     */
    addPoint(lat, lng) {
        // Crea oggetto tappa con ID univoco
        const p = { id: this.uid(), lat, lng };
        this.points.push(p);

        // Crea marker trascinabile su Leaflet
        const m = L.marker([lat, lng], { draggable: true }).addTo(this.map);

        // Click sul marker: rimuove la tappa
        m.on('click', () => this.removePoint(p.id));

        // Trascinamento: aggiorna coordinate e pulisce risultati
        m.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            p.lat = pos.lat;
            p.lng = pos.lng;
            this.updateList();           // Aggiorna lista UI
            this.clearRoute();           // Cancella percorso disegnato
            document.getElementById('results').innerHTML = ''; // Pulisce risultati
            this.collapseElevation();    // Collassa profilo altimetrico
        });

        // Salva riferimento marker
        this.markers.push({ id: p.id, marker: m });

        // Aggiorna interfaccia utente
        this.updateList();           // Ricostruisce lista tappe
        this.clearRoute();           // Cancella vecchio percorso
        document.getElementById('results').innerHTML = ''; // Pulisce risultati
        this.collapseElevation();    // Collassa profilo altimetrico
    }

    /**
     * Rimuove una tappa per ID
     * @param {string} id - ID della tappa da rimuovere
     */
    removePoint(id) {
        // Filtra le tappe escludendo quella da rimuovere
        this.points = this.points.filter(p => p.id !== id);

        // Trova e rimuove il marker dalla mappa
        const m = this.markers.find(x => x.id === id);
        if (m) this.map.removeLayer(m.marker);

        // Rimuove il riferimento dall'array markers
        this.markers = this.markers.filter(x => x.id !== id);

        // Aggiorna UI
        this.updateList();
        this.clearRoute();           // Cancella percorso
        document.getElementById('results').innerHTML = '';
        this.collapseElevation();    // Collassa profilo
    }

    /**
     * Aggiorna la lista HTML delle tappe nella sidebar
     */
    updateList() {
        const listDiv = document.getElementById("list");
        document.getElementById("stopCount").innerText = this.points.length;

        // Se non ci sono tappe, mostra messaggio placeholder
        if (this.points.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 12px;">🌿 Clicca sulla mappa o aggiungi un indirizzo</div>';
            return;
        }

        // Genera HTML per ogni tappa
        // i = indice (0-based), trasformato in 1-based per visualizzazione
        listDiv.innerHTML = this.points.map((p, i) => `
          <div class="stop-item">
            <div class="stop-number">${i + 1}</div>
            <div class="stop-info">
              <div class="stop-title">Tappa ${i + 1} ${i === 0 ? '🚩' : i === this.points.length - 1 ? '🏁' : ''}</div>
              <div class="stop-coords">${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°</div>
            </div>
            <button class="delete-stop" onclick="app.removePoint('${p.id}')">🗑️</button>
          </div>
        `).join(''); // join('') trasforma array in stringa HTML unica
    }

    /**
     * Geocodifica un indirizzo in coordinate tramite Nominatim API
     * @param {string} addr - Indirizzo da geocodificare
     * @returns {Promise<{lat: number, lng: number} | null>} Coordinate o null
     */
    async geocode(addr) {
        // Rate limiting: attendi almeno 1100ms tra una richiesta e l'altra
        const now = Date.now();
        if (now - this.lastNominatim < 1100) {
            await new Promise(r => setTimeout(r, 1100));
        }
        this.lastNominatim = Date.now();

        // Chiamata API a Nominatim (OpenStreetMap geocoding)
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
        const r = await fetch(url, { headers: { "User-Agent": "TSP-App" } });
        const d = await r.json();

        if (!d.length) return null;
        // Restituisce latitudine e longitudine del primo risultato
        return { lat: +d[0].lat, lng: +d[0].lon };
    }

    /**
     * Aggiunge una tappa tramite indirizzo inserito dall'utente
     */
    async addByAddress() {
        const addr = document.getElementById("addr").value;
        if (!addr) return alert("Inserisci un indirizzo");

        this.showLoading();          // Mostra caricamento
        const g = await this.geocode(addr); // Geocodifica
        this.hideLoading();          // Nasconde caricamento

        if (!g) return alert("Indirizzo non trovato");

        this.addPoint(g.lat, g.lng);      // Aggiunge tappa
        this.map.setView([g.lat, g.lng], 13); // Centra mappa sulla posizione
    }

    /**
     * Costruisce la matrice delle distanze/tempi tra le tappe
     * Utilizza OSRM Table API
     * @param {string} mode - Modalità di trasporto ('driving' o 'walking')
     */
    async buildMatrix(mode) {
        // Crea chiave cache basata su coordinate e modalità
        const key = JSON.stringify(this.points.map(p => [p.lat, p.lng, mode]));

        // Se già in cache, riutilizza
        if (this.cache.has(key)) {
            this.matrix = this.cache.get(key);
            return;
        }

        // Formato coordinate per OSRM: lng,lat;lng,lat;...
        const coords = this.points.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/${mode}/${coords}?annotations=duration,distance`;

        const r = await fetch(url);
        const d = await r.json();

        // Salva sia durate (minuti) che distanze (metri)
        this.matrix = {
            durations: d.durations,   // Tempi in secondi
            distances: d.distances    // Distanze in metri
        };

        // Memorizza in cache per future richieste
        this.cache.set(key, this.matrix);
    }

    /**
     * Calcola il costo totale di un percorso
     * @param {number[]} path - Array di indici delle tappe nell'ordine
     * @param {boolean} useDistance - Usa distanze invece di durate
     * @returns {number} Costo totale
     */
    cost(path, useDistance = false) {
        let s = 0;
        const matrix = useDistance ? this.matrix.distances : this.matrix.durations;

        // Somma i costi tra tappe consecutive
        for (let i = 1; i < path.length; i++) {
            s += matrix[path[i - 1]][path[i]];
        }
        return s;
    }

    /**
     * Algoritmo Nearest Neighbor (vicino più prossimo)
     * Parte da un indice startIndex e visita la tappa più vicina ad ogni passo
     * @param {number} startIndex - Indice della tappa di partenza
     * @returns {number[]} Percorso ottenuto
     */
    nearestNeighbor(startIndex) {
        const n = this.points.length;
        const visited = new Set();    // Insieme delle tappe già visitate
        let path = [startIndex];      // Percorso inizia con tappa start
        visited.add(startIndex);

        // Continua finché non visita tutte le tappe
        while (path.length < n) {
            let last = path[path.length - 1]; // Ultima tappa visitata
            let best = -1;
            let bestVal = Infinity;

            // Cerca la tappa non visitata più vicina
            for (let i = 0; i < n; i++) {
                if (visited.has(i)) continue;
                const dist = this.matrix.durations[last][i];
                if (dist < bestVal && dist !== null && dist !== undefined) {
                    bestVal = dist;
                    best = i;
                }
            }
            if (best === -1) break;   // Nessuna tappa raggiungibile

            visited.add(best);
            path.push(best);
        }
        return path;
    }

    /**
     * Nearest Neighbor con multiple partenze
     * Prova tutte le tappe come punto di partenza e sceglie il percorso migliore
     * @returns {number[]} Miglior percorso trovato
     */
    multiStartNN() {
        let bestPath = null;
        let bestCost = Infinity;

        // Prova ogni tappa come punto di partenza
        for (let i = 0; i < this.points.length; i++) {
            const p = this.nearestNeighbor(i);
            if (p.length === this.points.length) { // Verifica percorso completo
                const c = this.cost(p);
                if (c < bestCost) {  // Se migliore del best, aggiorna
                    bestCost = c;
                    bestPath = p;
                }
            }
        }
        return bestPath;
    }

    /**
     * Algoritmo 2-Opt per ottimizzazione percorsi
     * Inverte segmenti del percorso per ridurre il costo totale
     * @param {number[]} path - Percorso iniziale
     * @returns {number[]} Percorso ottimizzato
     */
    twoOpt(path) {
        let improved = true;
        let bestPath = [...path]; // Copia del percorso originale

        // Continua finché si trovano miglioramenti
        while (improved) {
            improved = false;

            // Prova tutte le possibili inversioni di segmenti
            for (let i = 1; i < bestPath.length - 2; i++) {
                for (let j = i + 1; j < bestPath.length; j++) {
                    // Inverte il segmento da i a j
                    const newPath = bestPath.slice(0, i)
                        .concat(bestPath.slice(i, j + 1).reverse())
                        .concat(bestPath.slice(j + 1));

                    // Se migliora il costo, applica la modifica
                    if (this.cost(newPath) < this.cost(bestPath)) {
                        bestPath = newPath;
                        improved = true;
                    }
                }
            }
        }
        return bestPath;
    }

    /**
     * Recupera il profilo altimetrico di un percorso
     * @param {Array} coordinates - Array di coordinate [lng, lat]
     * @returns {Promise<Array>} Array di punti {distance, elevation}
     */
    async getElevationProfile(coordinates) {
        const elevations = [];
        // Campiona meno punti per ridurre chiamate API
        const step = Math.max(1, Math.floor(coordinates.length / 30));

        // Raccogli le coordinate da richiedere in batch
        const locations = [];
        const indices = [];

        for (let i = 0; i < coordinates.length; i += step) {
            const coord = coordinates[i];
            locations.push({ lat: coord[1], lng: coord[0] });
            indices.push(i);
        }

        // Dividi in batch da 20 coordinate
        const batchSize = 20;
        const batches = [];

        for (let i = 0; i < locations.length; i += batchSize) {
            batches.push({
                locations: locations.slice(i, i + batchSize),
                indices: indices.slice(i, i + batchSize)
            });
        }

        // Processa i batch
        for (const batch of batches) {
            try {
                const response = await fetch('/api/elevation/batch', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ locations: batch.locations })
                });

                if (!response.ok) {
                    console.warn(`Errore batch: ${response.status}`);
                    continue;
                }

                const data = await response.json();

                if (data.results) {
                    data.results.forEach((result, idx) => {
                        if (result.results && result.results[0]) {
                            elevations.push({
                                distance: batch.indices[idx],
                                elevation: result.results[0].elevation
                            });
                        }
                    });
                }
            } catch (e) {
                console.warn('Errore altitudine batch:', e);
            }

            // Pausa tra batch per evitare rate limiting
            await new Promise(r => setTimeout(r, 500));
        }

        return elevations;
    }

    /**
     * Visualizza il profilo altimetrico con Chart.js
     * @param {Array} elevations - Dati altimetrici {distance, elevation}
     * @param {number} totalDistanceKm - Distanza totale in metri
     */
    displayElevationProfile(elevations, totalDistanceKm) {
        if (!elevations || elevations.length === 0) return;

        // Calcola distanze progressive in km
        const distances = elevations.map(e =>
            (e.distance * totalDistanceKm / 1000 / elevations[elevations.length - 1]?.distance || 1).toFixed(1)
        );
        const heights = elevations.map(e => e.elevation);

        // Statistiche altimetriche
        const minElev = Math.min(...heights);
        const maxElev = Math.max(...heights);
        let totalAscent = 0, totalDescent = 0;

        // Calcola salita e discesa totale
        for (let i = 1; i < heights.length; i++) {
            if (heights[i] > heights[i - 1])
                totalAscent += heights[i] - heights[i - 1];
            else if (heights[i] < heights[i - 1])
                totalDescent += heights[i - 1] - heights[i];
        }

        // Aggiorna HTML statistiche
        document.getElementById("elevationStats").innerHTML = `
          <div class="elevation-stat"><div class="value">${Math.round(minElev)}m</div><div class="label">Min</div></div>
          <div class="elevation-stat"><div class="value">${Math.round(maxElev)}m</div><div class="label">Max</div></div>
          <div class="elevation-stat"><div class="value">${Math.round(totalAscent)}m</div><div class="label">Salita</div></div>
          <div class="elevation-stat"><div class="value">${Math.round(totalDescent)}m</div><div class="label">Discesa</div></div>
          <div class="elevation-stat"><div class="value">${(maxElev - minElev).toFixed(0)}m</div><div class="label">Dislivello</div></div>
        `;

        // Distrugge grafico esistente se presente
        if (this.elevationChart) this.elevationChart.destroy();

        // Crea nuovo grafico Chart.js
        const ctx = document.getElementById('elevationChart').getContext('2d');
        this.elevationChart = new Chart(ctx, {
            type: 'line',                    // Grafico a linee
            data: {
                labels: distances,           // Asse X: distanze
                datasets: [{
                    label: 'Altitudine (m)',
                    data: heights,           // Asse Y: altitudini
                    borderColor: '#22c55e',  // Linea verde
                    backgroundColor: 'rgba(34,197,94,0.1)', // Riempimento trasparente
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3,            // Smoothing della curva
                    pointRadius: 0           // Nasconde i punti singoli
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    tooltip: { callbacks: { label: (ctx) => `${ctx.raw} m slm` } },
                    legend: { display: false } // Nasconde legenda
                },
                scales: {
                    x: { title: { display: true, text: 'Distanza (km)', font: { size: 10 } } },
                    y: { title: { display: true, text: 'Altitudine (m)', font: { size: 10 } }, beginAtZero: false }
                }
            }
        });
    }

    /**
     * Disegna il percorso sulla mappa e mostra statistiche
     * @param {number[]} path - Ordine ottimale delle tappe
     * @param {string} mode - Modalità di trasporto
     */
    async draw(path, mode) {
        // Costruisce stringa coordinate per OSRM: lng,lat;lng,lat...
        const coords = path.map(i => `${this.points[i].lng},${this.points[i].lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();

        if (!d.routes || d.routes.length === 0) throw new Error("Percorso non disponibile");

        const route = d.routes[0];

        // Rimuove vecchio layer percorso
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);

        // Aggiunge nuovo layer con stile verde
        this.routeLayer = L.geoJSON(route.geometry, {
            style: { color: "#22c55e", weight: 5, opacity: 0.9 }
        }).addTo(this.map);

        // Centra mappa sul percorso
        this.map.fitBounds(this.routeLayer.getBounds());

        // Calcola statistiche
        const totalDistance = (route.distance / 1000).toFixed(1);  // km
        const totalDuration = Math.round(route.duration / 60);    // minuti

        // Mostra risultati
        document.getElementById("results").innerHTML = `
          <div class="results-card">
            <div class="stat-row"><span class="stat-label">📏 Distanza</span><span class="stat-value">${totalDistance} km</span></div>
            <div class="stat-row"><span class="stat-label">⏱️ Durata</span><span class="stat-value">${totalDuration} min</span></div>
            <div class="stat-row"><span class="stat-label">📍 Tappe</span><span class="stat-value">${this.points.length}</span></div>
            <div class="stat-row"><span class="stat-label">✨ Algoritmo</span><span class="stat-value">${document.getElementById("algo").options[document.getElementById("algo").selectedIndex].text}</span></div>
          </div>
        `;

        // Recupera e mostra profilo altimetrico
        const elevations = await this.getElevationProfile(route.geometry.coordinates);
        this.displayElevationProfile(elevations, route.distance);

        // Espandi automaticamente pannello altimetrico
        if (this.panelCollapsed) this.toggleElevationPanel();
    }

    /**
     * Ricostruisce i marker della mappa nell'ordine ottimale
     * @param {number[]} path - Ordine ottimale delle tappe
     */
    rebuildMarkers(path) {
        // Rimuove tutti i marker esistenti
        this.markers.forEach(m => this.map.removeLayer(m.marker));
        this.markers = [];

        // Ricrea marker nell'ordine del percorso
        path.forEach((i, idx) => {
            const p = this.points[i];

            // HTML personalizzato per ogni marker
            let iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${idx + 1}</div>`;

            if (idx === 0) // Primo marker: bandiera partenza
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">🚩</div>`;

            if (idx === path.length - 1) // Ultimo marker: bandiera arrivo
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">🏁</div>`;

            // Crea icona personalizzata Leaflet
            const icon = L.divIcon({
                className: 'custom-marker',
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14]
            });

            // Aggiunge marker alla mappa
            const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
            m.bindPopup(`Tappa ${idx + 1}${idx === 0 ? ' (Partenza)' : idx === path.length - 1 ? ' (Arrivo)' : ''}`);
            m.on('click', () => this.removePoint(p.id)); // Click per rimuovere

            this.markers.push({ id: p.id, marker: m });
        });
    }

    /**
     * Rimuove il percorso dalla mappa
     */
    clearRoute() {
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        this.routeLayer = null;
    }

    /**
     * Collassa il pannello altimetrico se espanso
     */
    collapseElevation() {
        if (!this.panelCollapsed) this.toggleElevationPanel();
    }

    /**
     * Calcola il percorso ottimale
     * Metodo principale che coordina tutte le operazioni
     */
    async calculate() {
        // Verifica numero minimo di tappe
        if (this.points.length < 2) {
            alert("Inserisci almeno 2 tappe");
            return;
        }

        // Prepara UI
        this.showLoading();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";

        // Legge opzioni UI
        const mode = document.getElementById("mode").value;
        const algo = document.getElementById("algo").value;

        try {
            // 1. Costruisce matrice distanze/tempi
            await this.buildMatrix(mode);

            // 2. Calcola percorso ottimale (NN o 2-Opt)
            let path = algo === "nn" ? this.multiStartNN() : this.twoOpt(this.multiStartNN());

            if (!path || path.length !== this.points.length)
                throw new Error("Errore nel calcolo");

            // 3. Disegna percorso sulla mappa
            await this.draw(path, mode);

            // 4. Ricostruisce marker con numerazione corretta
            this.rebuildMarkers(path);

        } catch (error) {
            alert("Errore: " + error.message);
        } finally {
            this.hideLoading(); // Nasconde overlay sempre
        }
    }

    /**
     * Resetta completamente l'applicazione
     * Rimuove tutte le tappe, percorsi e risultati
     */
    reset() {
        // Svuota array tappe
        this.points = [];

        // Rimuove marker dalla mappa
        this.markers.forEach(m => this.map.removeLayer(m.marker));
        this.markers = [];

        // Rimuove percorso
        this.clearRoute();

        // Aggiorna UI
        this.updateList();
        document.getElementById("results").innerHTML = "";
        this.collapseElevation();

        // Distrugge grafico altimetrico
        if (this.elevationChart) {
            this.elevationChart.destroy();
            this.elevationChart = null;
        }

        // Pulisce statistiche
        document.getElementById("elevationStats").innerHTML = "";
    }
}

// Istanzia l'applicazione globale
// L'oggetto 'app' è accessibile da onclick negli elementi HTML
const app = new RoutePlanner();