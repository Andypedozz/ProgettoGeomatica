class RoutePlanner {
    constructor() {
        // ===== INIZIALIZZAZIONE MAPPA =====
        // Crea la mappa Leaflet centrata sull'Italia (latitudine 43.7, longitudine 12.6) con zoom 6
        this.map = L.map("map").setView([43.7, 12.6], 6);
        
        // Aggiunge il layer dei tile di OpenStreetMap per visualizzare la mappa
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            maxZoom: 19, // Limite massimo di zoom
        }).addTo(this.map);

        // ===== STATO DELL'APPLICAZIONE =====
        this.points = [];        // Array dei punti inseriti (ogni punto ha id, lat, lng)
        this.markers = [];       // Array dei marker sulla mappa
        this.matrix = null;      // Matrice delle distanze/tempi tra i punti
        this.cache = new Map();  // Cache per le matrici calcolate
        this.lastNominatim = 0;  // Timestamp ultima richiesta a Nominatim (per rate limiting)
        this.routeLayer = null;  // Layer della rotta visualizzata sulla mappa
        this.isDark = false;     // Tema corrente (chiaro/scuro)
        document.body.classList.remove("dark"); // Assicura che il tema iniziale sia chiaro

        // ===== EVENTI MAPPA =====
        // Aggiunge un punto quando si clicca sulla mappa
        this.map.on("click", (e) => this.addPoint(e.latlng.lat, e.latlng.lng));

        // Aggiorna l'interfaccia del tema (icona e testo del pulsante)
        this.updateThemeUI();

        // ===== PROFILO ALTIMETRICO =====
        // Inizializza canvas per il disegno del profilo altimetrico
        this.canvas = document.getElementById("elevationCanvas");
        this.ctx = this.canvas.getContext("2d");
        this.elevationWrap = document.getElementById("elevationCanvasWrap");
        this.elevationData = null; // Dati altimetrici correnti

        // ===== OSSERVATORI DI RESIZE =====
        // Osserva i cambiamenti di dimensione del contenitore della mappa
        this.resizeRAF = null;
        const mapContainer = document.querySelector(".map-container");
        this.mapResizeObserver = new ResizeObserver(() => this.scheduleMapResize());
        this.mapResizeObserver.observe(mapContainer);

        // Osserva i cambiamenti di dimensione del pannello altimetrico
        this.elevationResizeObserver = new ResizeObserver(() => {
            if (this.elevationData) this.drawElevationProfile(this.elevationData);
        });
        this.elevationResizeObserver.observe(this.elevationWrap);

        // ===== DRAG PER RIDIMENSIONARE IL PANNELLO ALTIMETRICO =====
        // Implementazione del trascinamento per ridimensionare il profilo altimetrico
        const handle = document.getElementById("elevResizeHandle");
        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onDrag = (e) => {
            if (!isDragging) return;
            const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
            // Logica invertita: mouse in alto = pannello più grande
            const delta = startY - clientY;
            let newH = Math.max(60, Math.min(300, startHeight + delta));
            document.querySelector(".elevation-profile").style.height = newH + "px";
            document.documentElement.style.setProperty("--elevation-height", newH + "px");
            if (this.elevationData) this.drawElevationProfile(this.elevationData);
            this.scheduleMapResize();
        };

        // Eventi per il trascinamento con mouse
        handle.addEventListener("mousedown", (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight = document.querySelector(".elevation-profile").offsetHeight;
            document.addEventListener("mousemove", onDrag);
            document.addEventListener("mouseup", () => {
                isDragging = false;
                document.removeEventListener("mousemove", onDrag);
            });
            e.preventDefault();
        });

        // Eventi per il trascinamento con touch (mobile)
        handle.addEventListener("touchstart", (e) => {
            const touch = e.touches[0];
            isDragging = true;
            startY = touch.clientY;
            startHeight = document.querySelector(".elevation-profile").offsetHeight;
            document.addEventListener("touchmove", onDrag);
            document.addEventListener("touchend", () => {
                isDragging = false;
                document.removeEventListener("touchmove", onDrag);
            });
            e.preventDefault();
        }, { passive: false });

        // ===== TOGGLE ALTIMETRIA (doppio click sul titolo) =====
        document.querySelector(".elevation-title").addEventListener("dblclick", () => {
            this.toggleElevation();
        });
    }

    // ===== GESTIONE RESIZE MAPPA =====
    // Programma il ridimensionamento della mappa usando requestAnimationFrame per performance
    scheduleMapResize() {
        if (this.resizeRAF) cancelAnimationFrame(this.resizeRAF);
        this.resizeRAF = requestAnimationFrame(() => {
            this.map.invalidateSize();
        });
    }

    // ===== LOADING UI =====
    showLoading() {
        document.getElementById("loadingOverlay").style.display = "flex";
    }
    hideLoading() {
        document.getElementById("loadingOverlay").style.display = "none";
    }

    // ===== TEMA CHIARO/SCURO =====
    toggleTheme() {
        this.isDark = !this.isDark;
        document.body.classList.toggle("dark", this.isDark);
        this.updateThemeUI();
        if (this.elevationData) this.drawElevationProfile(this.elevationData);
    }
    
    updateThemeUI() {
        const icon = document.getElementById("themeIcon");
        const text = document.getElementById("themeText");
        if (this.isDark) {
            icon.textContent = "☀️";
            text.textContent = "Light";
        } else {
            icon.textContent = "🌙";
            text.textContent = "Dark";
        }
    }

    // ===== TOGGLE SIDEBAR =====
    toggleSidebar() {
        document.getElementById("sidebar").classList.toggle("collapsed");
        setTimeout(() => this.scheduleMapResize(), 400); // Attesa per l'animazione CSS
    }

    // ===== TOGGLE PROFILO ALTIMETRICO =====
    toggleElevation() {
        document.getElementById("elevationProfile").classList.toggle("collapsed");
        setTimeout(() => {
            this.scheduleMapResize();
            if (this.elevationData && !document.getElementById("elevationProfile").classList.contains("collapsed")) {
                this.drawElevationProfile(this.elevationData);
            }
        }, 350); // Attesa per l'animazione CSS
    }

    // ===== UTILITY =====
    // Genera un ID univoco per ogni punto
    uid() { return Math.random().toString(36).slice(2); }

    // ===== GESTIONE PUNTI =====
    addPoint(lat, lng) {
        // Crea un nuovo punto con ID univoco
        const p = { id: this.uid(), lat, lng };
        this.points.push(p);
        
        // Crea un marker trascinabile sulla mappa
        const m = L.marker([lat, lng], { draggable: true }).addTo(this.map);
        
        // Eventi del marker
        m.on("click", () => this.removePoint(p.id)); // Click = rimuovi punto
        m.on("dragend", (e) => {
            // Quando il marker viene trascinato, aggiorna le coordinate
            const pos = e.target.getLatLng();
            p.lat = pos.lat;
            p.lng = pos.lng;
            this.updateList();
            this.clearRoute();
            document.getElementById("results").innerHTML = "";
            this.hideElevationProfile();
        });
        
        this.markers.push({ id: p.id, marker: m });
        
        // Aggiorna interfaccia e resetta la rotta
        this.updateList();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        this.hideElevationProfile();
    }

    removePoint(id) {
        // Rimuove il punto dall'array
        this.points = this.points.filter((p) => p.id !== id);
        // Rimuove il marker dalla mappa
        const m = this.markers.find((x) => x.id === id);
        if (m) this.map.removeLayer(m.marker);
        this.markers = this.markers.filter((x) => x.id !== id);
        // Aggiorna interfaccia
        this.updateList();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        this.hideElevationProfile();
    }

    updateList() {
        const listDiv = document.getElementById("list");
        document.getElementById("stopCount").innerText = this.points.length;
        
        // Se non ci sono punti, mostra messaggio placeholder
        if (this.points.length === 0) {
            listDiv.innerHTML =
                '<div style="text-align: center; padding: 20px; color: var(--ink-soft); font-size: 13px; font-weight: 500;">🌿 Clicca sulla mappa o aggiungi un indirizzo</div>';
            return;
        }
        
        // Genera HTML per la lista dei punti con numerazione
        listDiv.innerHTML = this.points.map((p, i) => `
      <div class="stop-item">
        <div class="stop-number">${i + 1}</div>
        <div class="stop-info">
          <div class="stop-title">Tappa ${i + 1} ${i === 0 ? "🚩" : i === this.points.length - 1 ? "🏁" : ""}</div>
          <div class="stop-coords">${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°</div>
        </div>
        <button class="delete-stop" onclick="app.removePoint('${p.id}')">🗑️</button>
      </div>
    `).join("");
    }

    // ===== GEOCODING =====
    async geocode(addr) {
        // Rate limiting: almeno 1.1 secondi tra le richieste a Nominatim
        const now = Date.now();
        if (now - this.lastNominatim < 1100) await new Promise((r) => setTimeout(r, 1100));
        this.lastNominatim = Date.now();
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`;
        const r = await fetch(url, { headers: { "User-Agent": "TSP-App" } });
        const d = await r.json();
        if (!d.length) return null;
        return { lat: +d[0].lat, lng: +d[0].lon };
    }

    async addByAddress() {
        const addr = document.getElementById("addr").value;
        if (!addr) return alert("Inserisci un indirizzo");
        this.showLoading();
        const g = await this.geocode(addr);
        this.hideLoading();
        if (!g) return alert("Indirizzo non trovato");
        this.addPoint(g.lat, g.lng);
        this.map.setView([g.lat, g.lng], 13); // Zoom sul punto aggiunto
    }

    // ===== MATRICE DISTANZE =====
    async buildMatrix(mode) {
        // Usa la cache per evitare richieste duplicate
        const key = JSON.stringify(this.points.map((p) => [p.lat, p.lng, mode]));
        if (this.cache.has(key)) { this.matrix = this.cache.get(key); return; }
        
        // Costruisce la richiesta OSRM con tutti i punti
        const coords = this.points.map((p) => `${p.lng},${p.lat}`).join(";");
        const url = `https://router.project-osrm.org/table/v1/${mode}/${coords}?annotations=duration,distance`;
        const r = await fetch(url);
        const d = await r.json();
        this.matrix = { durations: d.durations, distances: d.distances };
        this.cache.set(key, this.matrix);
    }

    // ===== FUNZIONI DI COSTO =====
    cost(path, useDistance = false) {
        let s = 0;
        const matrix = useDistance ? this.matrix.distances : this.matrix.durations;
        // Calcola il costo totale del percorso (somma delle distanze/tempi tra punti consecutivi)
        for (let i = 1; i < path.length; i++) s += matrix[path[i - 1]][path[i]];
        return s;
    }

    // ===== ALGORITMI DI OTTIMIZZAZIONE =====

    // Nearest Neighbor: trova un percorso partendo da un punto di partenza
    nearestNeighbor(startIndex) {
        const n = this.points.length;
        const visited = new Set();
        let path = [startIndex];
        visited.add(startIndex);
        
        while (path.length < n) {
            let last = path[path.length - 1];
            let best = -1,
                bestVal = Infinity;
            // Trova il punto non visitato più vicino all'ultimo punto
            for (let i = 0; i < n; i++) {
                if (visited.has(i)) continue;
                const dist = this.matrix.durations[last][i];
                if (dist < bestVal && dist !== null && dist !== undefined) { bestVal = dist;
                    best = i; }
            }
            if (best === -1) break;
            visited.add(best);
            path.push(best);
        }
        return path;
    }

    // Multi-start NN: esegue Nearest Neighbor da ogni punto e prende il percorso migliore
    multiStartNN() {
        let bestPath = null,
            bestCost = Infinity;
        for (let i = 0; i < this.points.length; i++) {
            const p = this.nearestNeighbor(i);
            if (p.length === this.points.length) {
                const c = this.cost(p);
                if (c < bestCost) { bestCost = c;
                    bestPath = p; }
            }
        }
        return bestPath;
    }

    // 2-opt: migliora il percorso invertendo sottosezioni per eliminare incroci
    twoOpt(path) {
        let improved = true;
        let bestPath = [...path];
        while (improved) {
            improved = false;
            // Prova tutte le possibili inversioni di sottosezioni
            for (let i = 1; i < bestPath.length - 2; i++) {
                for (let j = i + 1; j < bestPath.length; j++) {
                    const newPath = bestPath.slice(0, i).concat(bestPath.slice(i, j + 1).reverse()).concat(bestPath.slice(j + 1));
                    if (this.cost(newPath) < this.cost(bestPath)) { bestPath = newPath;
                        improved = true; }
                }
            }
        }
        return bestPath;
    }

    // ===== PROFILO ALTIMETRICO =====
    async fetchElevationProfile(path, mode) {
        // Ottiene la geometria del percorso da OSRM
        const coords = path.map((i) => `${this.points[i].lng},${this.points[i].lat}`).join(";");
        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.routes || d.routes.length === 0) throw new Error("Percorso non disponibile");
        
        const geometry = d.routes[0].geometry;
        const points = geometry.coordinates.map((c) => ({ lng: c[0], lat: c[1] }));
        
        // Campiona il percorso per ridurre il numero di punti (massimo 100 punti)
        const step = Math.max(1, Math.floor(points.length / 100));
        const sampled = points.filter((_, i) => i % step === 0);
        
        // Richiede le altitudini all'API Open-Elevation
        const elevUrl = "https://api.open-elevation.com/api/v1/lookup";
        const body = { locations: sampled.map((p) => ({ latitude: p.lat, longitude: p.lng })) };
        const elevR = await fetch(elevUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!elevR.ok) throw new Error("Errore nel recupero altitudini");
        const elevD = await elevR.json();
        
        // Calcola le distanze cumulative lungo il percorso in km
        let cumulativeDist = 0;
        const distances = [0];
        for (let i = 1; i < sampled.length; i++) {
            const dx = sampled[i].lng - sampled[i - 1].lng;
            const dy = sampled[i].lat - sampled[i - 1].lat;
            cumulativeDist += Math.sqrt(dx * dx + dy * dy) * 111.32; // Converte gradi in km
            distances.push(cumulativeDist);
        }
        
        const elevations = elevD.results.map((r) => r.elevation);
        return { elevations, distances };
    }

    drawElevationProfile(data) {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const profile = document.getElementById("elevationProfile");
        if (profile.classList.contains("collapsed")) return; // Non disegnare se nascosto

        // Dimensioni del canvas
        const wrapRect = this.elevationWrap.getBoundingClientRect();
        const width = Math.max(0, Math.floor(wrapRect.width));
        const height = Math.max(0, Math.floor(wrapRect.height));
        if (width === 0 || height === 0) return;

        // Gestione DPI per rendering ad alta risoluzione
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Margini del grafico
        const padding = { top: 6, bottom: 4, left: 6, right: 6 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const elevs = data.elevations;
        const dists = data.distances;
        
        // Colori dal tema corrente
        const rootStyles = getComputedStyle(document.documentElement);
        const inkSoft = rootStyles.getPropertyValue("--ink-soft").trim() || "#52604e";
        const bodyFont = rootStyles.getPropertyValue("--font-body").trim() || "sans-serif";

        // Se ci sono meno di 2 punti, mostra messaggio
        if (elevs.length < 2) {
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = inkSoft;
            ctx.font = `10px ${bodyFont}`;
            ctx.textAlign = "center";
            ctx.fillText("Dati altimetrici insufficienti", width / 2, height / 2 + 4);
            return;
        }

        // Calcola min e max altitudine
        let minElev = Math.min(...elevs);
        let maxElev = Math.max(...elevs);
        const range = maxElev - minElev || 1;
        
        // Colori in base al tema
        const isDark = this.isDark;
        const lineColor = isDark ? "#e2803f" : "#c1562f";
        const fillColor = isDark ? "rgba(226, 128, 63, 0.2)" : "rgba(193, 86, 47, 0.15)";
        const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
        const textColor = inkSoft;

        ctx.clearRect(0, 0, width, height);

        // Griglia orizzontale (4 linee)
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }

        // Area sotto la curva (fill)
        ctx.beginPath();
        const startX = padding.left;
        const startY = padding.top + chartHeight - ((elevs[0] - minElev) / range) * chartHeight;
        ctx.moveTo(startX, startY);
        for (let i = 0; i < elevs.length; i++) {
            const x = padding.left + (dists[i] / dists[dists.length - 1]) * chartWidth;
            const y = padding.top + chartHeight - ((elevs[i] - minElev) / range) * chartHeight;
            ctx.lineTo(x, y);
        }
        const lastX = padding.left + chartWidth;
        ctx.lineTo(lastX, padding.top + chartHeight);
        ctx.lineTo(startX, padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Curva dell'elevazione (linea)
        ctx.beginPath();
        for (let i = 0; i < elevs.length; i++) {
            const x = padding.left + (dists[i] / dists[dists.length - 1]) * chartWidth;
            const y = padding.top + chartHeight - ((elevs[i] - minElev) / range) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Aggiorna le statistiche nel DOM
        const totalDist = dists[dists.length - 1];
        const gain = maxElev - minElev;
        document.getElementById("elevationStats").textContent = `${totalDist.toFixed(1)} km · ${Math.round(gain)} m dislivello`;
        document.getElementById("elevMin").textContent = `${Math.round(minElev)} m`;
        document.getElementById("elevMax").textContent = `${Math.round(maxElev)} m`;
    }

    hideElevationProfile() {
        document.getElementById("elevationProfile").classList.add("collapsed");
        this.elevationData = null;
    }

    // ===== VISUALIZZAZIONE ROTTA =====
    async draw(path, mode) {
        // Ottiene il percorso da OSRM
        const coords = path.map((i) => `${this.points[i].lng},${this.points[i].lat}`).join(";");
        const url = `https://router.project-osrm.org/route/v1/${mode}/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.routes || d.routes.length === 0) throw new Error("Percorso non disponibile");
        
        const route = d.routes[0];
        
        // Rimuove la rotta precedente e disegna la nuova
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        this.routeLayer = L.geoJSON(route.geometry, {
            style: { color: "#22c55e", weight: 5, opacity: 0.9 },
        }).addTo(this.map);

        // Mostra le statistiche del percorso
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

        // Carica e mostra il profilo altimetrico
        try {
            const elevData = await this.fetchElevationProfile(path, mode);
            this.elevationData = elevData;
            document.getElementById("elevationProfile").classList.remove("collapsed");
            this.drawElevationProfile(elevData);
        } catch (err) {
            console.warn("Profilo altimetrico non disponibile:", err);
            this.hideElevationProfile();
        }

        // Adatta la mappa per mostrare tutto il percorso
        requestAnimationFrame(() => {
            this.map.invalidateSize();
            this.map.fitBounds(this.routeLayer.getBounds());
        });
    }

    rebuildMarkers(path) {
        // Rimuove tutti i marker esistenti
        this.markers.forEach((m) => this.map.removeLayer(m.marker));
        this.markers = [];
        
        // Ricrea i marker in ordine di percorso con numerazione e icone speciali
        path.forEach((i, idx) => {
            const p = this.points[i];
            let iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">${idx + 1}</div>`;
            if (idx === 0) iconHtml =
                `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">🚩</div>`;
            if (idx === path.length - 1) iconHtml =
                `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">🏁</div>`;
            
            const icon = L.divIcon({
                className: "custom-marker",
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14],
            });
            
            const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
            m.bindPopup(`Tappa ${idx + 1}${idx === 0 ? " (Partenza)" : idx === path.length - 1 ? " (Arrivo)" : ""}`);
            m.on("click", () => this.removePoint(p.id));
            this.markers.push({ id: p.id, marker: m });
        });
    }

    // ===== UTILITY DI PULIZIA =====
    clearRoute() {
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        this.routeLayer = null;
    }

    // ===== CALCOLO PRINCIPALE =====
    async calculate() {
        if (this.points.length < 2) { alert("Inserisci almeno 2 tappe"); return; }
        
        this.showLoading();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        
        const mode = document.getElementById("mode").value;
        const algo = document.getElementById("algo").value;
        
        try {
            // Calcola la matrice delle distanze
            await this.buildMatrix(mode);
            
            // Esegue l'algoritmo scelto
            let path = algo === "nn" ? this.multiStartNN() : this.twoOpt(this.multiStartNN());
            if (!path || path.length !== this.points.length) throw new Error("Errore nel calcolo");
            
            // Visualizza il percorso
            await this.draw(path, mode);
            this.rebuildMarkers(path);
        } catch (error) {
            alert("Errore: " + error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ===== RESET =====
    reset() {
        // Pulisce tutti i punti e i marker
        this.points = [];
        this.markers.forEach((m) => this.map.removeLayer(m.marker));
        this.markers = [];
        this.clearRoute();
        this.hideElevationProfile();
        this.updateList();
        document.getElementById("results").innerHTML = "";
    }
}

// ===== INIZIALIZZAZIONE APP =====
const app = new RoutePlanner();