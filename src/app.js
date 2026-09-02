/**
 * Classe principale RoutePlanner
 * Gestisce tutte le funzionalità dell'applicazione di ottimizzazione percorsi
 * - Mappa interattiva con Leaflet
 * - Gestione tappe (aggiunta, rimozione, modifica)
 * - Calcolo percorso ottimale con algoritmi TSP
 * - Tema chiaro/scuro
 * - Profilo altimetrico
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
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Array delle tappe (punti da visitare)
        this.points = [];           // { id, lat, lng }
        this.markers = [];          // Riferimenti ai marker Leaflet { id, marker }
        this.matrix = null;         // Matrice delle distanze/tempi tra le tappe
        this.cache = new Map();     // Cache per matrici già calcolate

        // Rate limiting per Nominatim (1 richiesta al secondo)
        this.lastNominatim = 0;

        // Layer della route tracciata sulla mappa
        this.routeLayer = null;

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

        // Riferimento al canvas per il profilo altimetrico
        this.canvas = document.getElementById('elevationCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.elevationWrap = document.getElementById('elevationCanvasWrap');

        // Dati del profilo altimetrico
        this.elevationData = null;

        // La mappa Leaflet non si accorge da sola se il suo contenitore
        // cambia dimensione (sidebar che cresce, pannello altimetrico che
        // appare/scompare, rotazione schermo, resize finestra...).
        // Un ResizeObserver sul contenitore osserva TUTTI questi casi,
        // non solo il resize della finestra.
        this.resizeRAF = null;
        const mapContainer = document.querySelector('.map-container');
        this.mapResizeObserver = new ResizeObserver(() => this.scheduleMapResize());
        this.mapResizeObserver.observe(mapContainer);

        // Allo stesso modo, il canvas del profilo altimetrico deve
        // ridisegnarsi ogni volta che il SUO wrapper cambia dimensione,
        // non solo quando cambia la finestra.
        this.elevationResizeObserver = new ResizeObserver(() => {
            if (this.elevationData) this.drawElevationProfile(this.elevationData);
        });
        this.elevationResizeObserver.observe(this.elevationWrap);
    }

    /**
     * Pianifica un invalidateSize() della mappa in un unico frame,
     * evitando ricalcoli multipli e inutili durante un resize continuo
     */
    scheduleMapResize() {
        if (this.resizeRAF) cancelAnimationFrame(this.resizeRAF);
        this.resizeRAF = requestAnimationFrame(() => {
            this.map.invalidateSize();
        });
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
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
        this.updateThemeUI();
        // Ridisegna il profilo se visibile
        if (this.elevationData) {
            this.drawElevationProfile(this.elevationData);
        }
    }

    /**
     * Aggiorna l'interfaccia del toggle tema (icona e testo)
     */
    updateThemeUI() {
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if (this.isDark) {
            icon.textContent = '☀️';
            text.textContent = 'Light';
        } else {
            icon.textContent = '🌙';
            text.textContent = 'Dark';
        }
    }

    /**
     * Genera un ID univoco per ogni tappa
     * @returns {string} ID randomico
     */
    uid() {
        return Math.random().toString(36).slice(2);
    }

    /**
     * Aggiunge una nuova tappa alla mappa e alla lista
     * @param {number} lat - Latitudine
     * @param {number} lng - Longitudine
     */
    addPoint(lat, lng) {
        const p = { id: this.uid(), lat, lng };
        this.points.push(p);

        const m = L.marker([lat, lng], { draggable: true }).addTo(this.map);

        m.on('click', () => this.removePoint(p.id));

        m.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            p.lat = pos.lat;
            p.lng = pos.lng;
            this.updateList();
            this.clearRoute();
            document.getElementById('results').innerHTML = '';
            this.hideElevationProfile();
        });

        this.markers.push({ id: p.id, marker: m });

        this.updateList();
        this.clearRoute();
        document.getElementById('results').innerHTML = '';
        this.hideElevationProfile();
    }

    /**
     * Rimuove una tappa per ID
     * @param {string} id - ID della tappa da rimuovere
     */
    removePoint(id) {
        this.points = this.points.filter(p => p.id !== id);

        const m = this.markers.find(x => x.id === id);
        if (m) this.map.removeLayer(m.marker);

        this.markers = this.markers.filter(x => x.id !== id);

        this.updateList();
        this.clearRoute();
        document.getElementById('results').innerHTML = '';
        this.hideElevationProfile();
    }

    /**
     * Aggiorna la lista HTML delle tappe nella sidebar
     */
    updateList() {
        const listDiv = document.getElementById("list");
        document.getElementById("stopCount").innerText = this.points.length;

        if (this.points.length === 0) {
            listDiv.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--ink-soft); font-size: 12px;">🌿 Clicca sulla mappa o aggiungi un indirizzo</div>';
            return;
        }

        listDiv.innerHTML = this.points.map((p, i) => `
          <div class="stop-item">
            <div class="stop-number">${i + 1}</div>
            <div class="stop-info">
              <div class="stop-title">Tappa ${i + 1} ${i === 0 ? '🚩' : i === this.points.length - 1 ? '🏁' : ''}</div>
              <div class="stop-coords">${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°</div>
            </div>
            <button class="delete-stop" onclick="app.removePoint('${p.id}')">🗑️</button>
          </div>
        `).join('');
    }

    /**
     * Geocodifica un indirizzo in coordinate tramite Nominatim API
     * @param {string} addr - Indirizzo da geocodificare
     * @returns {Promise<{lat: number, lng: number} | null>} Coordinate o null
     */
    async geocode(addr) {
        const now = Date.now();
        if (now - this.lastNominatim < 1100) {
            await new Promise(r => setTimeout(r, 1100));
        }
        this.lastNominatim = Date.now();

        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
        const r = await fetch(url, { headers: { "User-Agent": "TSP-App" } });
        const d = await r.json();

        if (!d.length) return null;
        return { lat: +d[0].lat, lng: +d[0].lon };
    }

    /**
     * Aggiunge una tappa tramite indirizzo inserito dall'utente
     */
    async addByAddress() {
        const addr = document.getElementById("addr").value;
        if (!addr) return alert("Inserisci un indirizzo");

        this.showLoading();
        const g = await this.geocode(addr);
        this.hideLoading();

        if (!g) return alert("Indirizzo non trovato");

        this.addPoint(g.lat, g.lng);
        this.map.setView([g.lat, g.lng], 13);
    }

    /**
     * Costruisce la matrice delle distanze/tempi tra le tappe
     * Utilizza OSRM Table API
     * @param {string} mode - Modalità di trasporto ('driving' o 'walking')
     */
    async buildMatrix(mode) {
        const key = JSON.stringify(this.points.map(p => [p.lat, p.lng, mode]));

        if (this.cache.has(key)) {
            this.matrix = this.cache.get(key);
            return;
        }

        const coords = this.points.map(p => `${p.lng},${p.lat}`).join(';');
        const url = `https://router.project-osrm.org/table/v1/${mode}/${coords}?annotations=duration,distance`;

        const r = await fetch(url);
        const d = await r.json();

        this.matrix = {
            durations: d.durations,
            distances: d.distances
        };

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

        for (let i = 1; i < path.length; i++) {
            s += matrix[path[i - 1]][path[i]];
        }
        return s;
    }

    /**
     * Algoritmo Nearest Neighbor (vicino più prossimo)
     * @param {number} startIndex - Indice della tappa di partenza
     * @returns {number[]} Percorso ottenuto
     */
    nearestNeighbor(startIndex) {
        const n = this.points.length;
        const visited = new Set();
        let path = [startIndex];
        visited.add(startIndex);

        while (path.length < n) {
            let last = path[path.length - 1];
            let best = -1;
            let bestVal = Infinity;

            for (let i = 0; i < n; i++) {
                if (visited.has(i)) continue;
                const dist = this.matrix.durations[last][i];
                if (dist < bestVal && dist !== null && dist !== undefined) {
                    bestVal = dist;
                    best = i;
                }
            }
            if (best === -1) break;

            visited.add(best);
            path.push(best);
        }
        return path;
    }

    /**
     * Nearest Neighbor con multiple partenze
     * @returns {number[]} Miglior percorso trovato
     */
    multiStartNN() {
        let bestPath = null;
        let bestCost = Infinity;

        for (let i = 0; i < this.points.length; i++) {
            const p = this.nearestNeighbor(i);
            if (p.length === this.points.length) {
                const c = this.cost(p);
                if (c < bestCost) {
                    bestCost = c;
                    bestPath = p;
                }
            }
        }
        return bestPath;
    }

    /**
     * Algoritmo 2-Opt per ottimizzazione percorsi
     * @param {number[]} path - Percorso iniziale
     * @returns {number[]} Percorso ottimizzato
     */
    twoOpt(path) {
        let improved = true;
        let bestPath = [...path];

        while (improved) {
            improved = false;

            for (let i = 1; i < bestPath.length - 2; i++) {
                for (let j = i + 1; j < bestPath.length; j++) {
                    const newPath = bestPath.slice(0, i)
                        .concat(bestPath.slice(i, j + 1).reverse())
                        .concat(bestPath.slice(j + 1));

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
     * Recupera il profilo altimetrico del percorso
     * @param {number[]} path - Ordine delle tappe
     * @param {string} mode - Modalità di trasporto
     * @returns {Promise<{elevations: number[], distances: number[]}>}
     */
    async fetchElevationProfile(path, mode) {
        // Ottieni la geometria del percorso da OSRM
        const coords = path.map(i => `${this.points[i].lng},${this.points[i].lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();

        if (!d.routes || d.routes.length === 0) throw new Error("Percorso non disponibile");

        // Estrai i punti della geometria
        const geometry = d.routes[0].geometry;
        const points = geometry.coordinates.map(c => ({ lng: c[0], lat: c[1] }));

        // Campiona un numero ragionevole di punti (massimo 100)
        const step = Math.max(1, Math.floor(points.length / 100));
        const sampled = points.filter((_, i) => i % step === 0);

        // Chiamata API Open-Elevation per le altitudini
        const elevUrl = 'https://api.open-elevation.com/api/v1/lookup';
        const body = {
            locations: sampled.map(p => ({ latitude: p.lat, longitude: p.lng }))
        };

        const elevR = await fetch(elevUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!elevR.ok) throw new Error('Errore nel recupero altitudini');

        const elevD = await elevR.json();

        // Costruisci le distanze cumulative lungo il percorso
        let cumulativeDist = 0;
        const distances = [0];

        for (let i = 1; i < sampled.length; i++) {
            const dx = sampled[i].lng - sampled[i-1].lng;
            const dy = sampled[i].lat - sampled[i-1].lat;
            // Approssimazione in km (non precisa ma sufficiente per il profilo)
            cumulativeDist += Math.sqrt(dx*dx + dy*dy) * 111.32;
            distances.push(cumulativeDist);
        }

        const elevations = elevD.results.map(r => r.elevation);

        return { elevations, distances };
    }

    /**
     * Disegna il profilo altimetrico sul canvas
     * @param {{elevations: number[], distances: number[]}} data
     */
    drawElevationProfile(data) {
        const canvas = this.canvas;
        const ctx = this.ctx;

        // Il pannello va reso visibile PRIMA di misurare il wrapper:
        // finché è display:none le sue dimensioni sono 0x0. Cambiare la
        // classe e poi leggere subito getBoundingClientRect forza il
        // browser a un reflow sincrono, quindi la misura è già corretta.
        document.getElementById('elevationProfile').classList.add('visible');

        // Le dimensioni si leggono dal wrapper dedicato al canvas, non
        // dall'intero pannello (che include anche header ed etichette):
        // usare quello causava un'altezza sbagliata e un profilo
        // tagliato o schiacciato.
        const wrapRect = this.elevationWrap.getBoundingClientRect();
        const width = Math.max(0, Math.floor(wrapRect.width));
        const height = Math.max(0, Math.floor(wrapRect.height));

        // Se il pannello non è (ancora) visibile o non ha spazio reale,
        // rimandiamo: disegnare su un canvas 0x0 non ha senso e verrà
        // comunque richiamato dal ResizeObserver appena avrà dimensioni.
        if (width === 0 || height === 0) return;

        const dpr = window.devicePixelRatio || 1;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        // setTransform (invece di scale) resetta la matrice ad ogni
        // ridisegno: con scale() la trasformazione si accumulerebbe ogni
        // volta (cambio tema, resize, ecc.), deformando il profilo dopo
        // pochi ridisegni.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const padding = { top: 6, bottom: 4, left: 6, right: 6 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const elevs = data.elevations;
        const dists = data.distances;

        // Le CSS custom properties non sono valori validi per fillStyle/
        // font del canvas: vanno risolte leggendo il loro valore calcolato.
        const rootStyles = getComputedStyle(document.documentElement);
        const inkSoft = rootStyles.getPropertyValue('--ink-soft').trim() || '#52604e';
        const bodyFont = rootStyles.getPropertyValue('--font-body').trim() || 'sans-serif';

        if (elevs.length < 2) {
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = inkSoft;
            ctx.font = `10px ${bodyFont}`;
            ctx.textAlign = 'center';
            ctx.fillText('Dati altimetrici insufficienti', width/2, height/2 + 4);
            return;
        }

        // Calcola min e max
        let minElev = Math.min(...elevs);
        let maxElev = Math.max(...elevs);
        const range = maxElev - minElev || 1;

        // Colori tema
        const isDark = this.isDark;
        const lineColor = isDark ? '#e2803f' : '#c1562f';
        const fillColor = isDark ? 'rgba(226, 128, 63, 0.2)' : 'rgba(193, 86, 47, 0.15)';
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        const textColor = inkSoft;

        ctx.clearRect(0, 0, width, height);

        // Linee della griglia
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }

        // Area fill
        ctx.beginPath();
        const startX = padding.left;
        const startY = padding.top + chartHeight - ((elevs[0] - minElev) / range) * chartHeight;
        ctx.moveTo(startX, startY);

        for (let i = 0; i < elevs.length; i++) {
            const x = padding.left + (dists[i] / dists[dists.length-1]) * chartWidth;
            const y = padding.top + chartHeight - ((elevs[i] - minElev) / range) * chartHeight;
            ctx.lineTo(x, y);
        }

        // Chiudi il poligono fino in basso
        const lastX = padding.left + chartWidth;
        ctx.lineTo(lastX, padding.top + chartHeight);
        ctx.lineTo(startX, padding.top + chartHeight);
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();

        // Linea del profilo
        ctx.beginPath();
        for (let i = 0; i < elevs.length; i++) {
            const x = padding.left + (dists[i] / dists[dists.length-1]) * chartWidth;
            const y = padding.top + chartHeight - ((elevs[i] - minElev) / range) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Aggiorna statistiche
        const totalDist = dists[dists.length-1];
        const gain = maxElev - minElev;
        document.getElementById('elevationStats').textContent =
            `${totalDist.toFixed(1)} km · ${Math.round(gain)} m dislivello`;

        document.getElementById('elevMin').textContent = `${Math.round(minElev)} m`;
        document.getElementById('elevMax').textContent = `${Math.round(maxElev)} m`;
    }

    /**
     * Nasconde il profilo altimetrico
     */
    hideElevationProfile() {
        document.getElementById('elevationProfile').classList.remove('visible');
        this.elevationData = null;
    }

    /**
     * Disegna il percorso sulla mappa e mostra statistiche
     * @param {number[]} path - Ordine ottimale delle tappe
     * @param {string} mode - Modalità di trasporto
     */
    async draw(path, mode) {
        const coords = path.map(i => `${this.points[i].lng},${this.points[i].lat}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();

        if (!d.routes || d.routes.length === 0) throw new Error("Percorso non disponibile");

        const route = d.routes[0];

        if (this.routeLayer) this.map.removeLayer(this.routeLayer);

        this.routeLayer = L.geoJSON(route.geometry, {
            style: { color: "#22c55e", weight: 5, opacity: 0.9 }
        }).addTo(this.map);

        const totalDistance = (route.distance / 1000).toFixed(1);
        const totalDuration = Math.round(route.duration / 60);

        document.getElementById("results").innerHTML = `
          <div class="results-card">
            <div class="stat-row"><span class="stat-label">📏 Distanza</span><span class="stat-value">${totalDistance} km</span></div>
            <div class="stat-row"><span class="stat-label">⏱️ Durata</span><span class="stat-value">${totalDuration} min</span></div>
            <div class="stat-row"><span class="stat-label">📍 Tappe</span><span class="stat-value">${this.points.length}</span></div>
            <div class="stat-row"><span class="stat-label">✨ Algoritmo</span><span class="stat-value">${document.getElementById("algo").options[document.getElementById("algo").selectedIndex].text}</span></div>
          </div>
        `;

        // Recupera e disegna il profilo altimetrico. Lo facciamo PRIMA di
        // inquadrare il percorso perché mostrare/nascondere questo pannello
        // cambia l'altezza della mappa: se calcolassimo i bounds prima,
        // l'inquadratura risulterebbe sbagliata non appena il pannello
        // compare o scompare.
        try {
            const elevData = await this.fetchElevationProfile(path, mode);
            this.elevationData = elevData;
            this.drawElevationProfile(elevData);
        } catch (err) {
            console.warn('Profilo altimetrico non disponibile:', err);
            this.hideElevationProfile();
        }

        // Aspetta un frame per lasciare che il layout si assesti
        // (transizione del pannello altimetrico), poi ricalcola le
        // dimensioni reali della mappa e inquadra il percorso.
        requestAnimationFrame(() => {
            this.map.invalidateSize();
            this.map.fitBounds(this.routeLayer.getBounds());
        });
    }

    /**
     * Ricostruisce i marker della mappa nell'ordine ottimale
     * @param {number[]} path - Ordine ottimale delle tappe
     */
    rebuildMarkers(path) {
        this.markers.forEach(m => this.map.removeLayer(m.marker));
        this.markers = [];

        path.forEach((i, idx) => {
            const p = this.points[i];

            let iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${idx + 1}</div>`;

            if (idx === 0)
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">🚩</div>`;

            if (idx === path.length - 1)
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">🏁</div>`;

            const icon = L.divIcon({
                className: 'custom-marker',
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14]
            });

            const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
            m.bindPopup(`Tappa ${idx + 1}${idx === 0 ? ' (Partenza)' : idx === path.length-1 ? ' (Arrivo)' : ''}`);
            m.on('click', () => this.removePoint(p.id));

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
     * Calcola il percorso ottimale
     * Metodo principale che coordina tutte le operazioni
     */
    async calculate() {
        if (this.points.length < 2) {
            alert("Inserisci almeno 2 tappe");
            return;
        }

        this.showLoading();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        this.hideElevationProfile();

        const mode = document.getElementById("mode").value;
        const algo = document.getElementById("algo").value;

        try {
            await this.buildMatrix(mode);

            let path = algo === "nn" ? this.multiStartNN() : this.twoOpt(this.multiStartNN());

            if (!path || path.length !== this.points.length)
                throw new Error("Errore nel calcolo");

            await this.draw(path, mode);
            this.rebuildMarkers(path);

        } catch (error) {
            alert("Errore: " + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Resetta completamente l'applicazione
     * Rimuove tutte le tappe, percorsi e risultati
     */
    reset() {
        this.points = [];

        this.markers.forEach(m => this.map.removeLayer(m.marker));
        this.markers = [];

        this.clearRoute();
        this.hideElevationProfile();

        this.updateList();
        document.getElementById("results").innerHTML = "";
    }
}

// Istanzia l'applicazione globale
const app = new RoutePlanner();