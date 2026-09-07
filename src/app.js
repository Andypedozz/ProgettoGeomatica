class RoutePlanner {
    constructor() {
        this.map = L.map("map").setView([43.7, 12.6], 6);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap contributors",
            maxZoom: 19,
        }).addTo(this.map);

        this.points = [];
        this.markers = [];
        this.matrix = null;
        this.cache = new Map();
        this.lastNominatim = 0;
        this.routeLayer = null;
        this.isDark = false;
        document.body.classList.remove("dark");

        this.map.on("click", (e) => this.addPoint(e.latlng.lat, e.latlng.lng));
        this.updateThemeUI();

        this.canvas = document.getElementById("elevationCanvas");
        this.ctx = this.canvas.getContext("2d");
        this.elevationWrap = document.getElementById("elevationCanvasWrap");
        this.elevationData = null;

        this.resizeRAF = null;
        const mapContainer = document.querySelector(".map-container");
        this.mapResizeObserver = new ResizeObserver(() =>
            this.scheduleMapResize(),
        );
        this.mapResizeObserver.observe(mapContainer);

        this.elevationResizeObserver = new ResizeObserver(() => {
            if (this.elevationData)
                this.drawElevationProfile(this.elevationData);
        });
        this.elevationResizeObserver.observe(this.elevationWrap);

        const handle = document.getElementById("elevResizeHandle");
        let isDragging = false;
        let startY = 0;
        let startHeight = 0;

        const onDrag = (e) => {
            if (!isDragging) return;
            const clientY = e.clientY || e.touches?.[0]?.clientY || 0;
            const delta = startY - clientY;
            let newH = Math.max(60, Math.min(300, startHeight + delta));
            document.querySelector(".elevation-profile").style.height =
                newH + "px";
            document.documentElement.style.setProperty(
                "--elevation-height",
                newH + "px",
            );
            if (this.elevationData)
                this.drawElevationProfile(this.elevationData);
            this.scheduleMapResize();
        };

        handle.addEventListener("mousedown", (e) => {
            isDragging = true;
            startY = e.clientY;
            startHeight =
                document.querySelector(".elevation-profile").offsetHeight;
            document.addEventListener("mousemove", onDrag);
            document.addEventListener("mouseup", () => {
                isDragging = false;
                document.removeEventListener("mousemove", onDrag);
            });
            e.preventDefault();
        });

        handle.addEventListener(
            "touchstart",
            (e) => {
                const touch = e.touches[0];
                isDragging = true;
                startY = touch.clientY;
                startHeight =
                    document.querySelector(".elevation-profile").offsetHeight;
                document.addEventListener("touchmove", onDrag);
                document.addEventListener("touchend", () => {
                    isDragging = false;
                    document.removeEventListener("touchmove", onDrag);
                });
                e.preventDefault();
            },
            { passive: false },
        );

        document
            .querySelector(".elevation-title")
            .addEventListener("dblclick", () => {
                this.toggleElevation();
            });

        this.EXACT_LIMIT = 12;
    }

    scheduleMapResize() {
        if (this.resizeRAF) cancelAnimationFrame(this.resizeRAF);
        this.resizeRAF = requestAnimationFrame(() => {
            this.map.invalidateSize();
        });
    }

    showLoading() {
        document.getElementById("loadingOverlay").style.display = "flex";
    }
    hideLoading() {
        document.getElementById("loadingOverlay").style.display = "none";
    }

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

    toggleSidebar() {
        document.getElementById("sidebar").classList.toggle("collapsed");
        setTimeout(() => this.scheduleMapResize(), 400);
    }

    toggleElevation() {
        document
            .getElementById("elevationProfile")
            .classList.toggle("collapsed");
        setTimeout(() => {
            this.scheduleMapResize();
            if (
                this.elevationData &&
                !document
                    .getElementById("elevationProfile")
                    .classList.contains("collapsed")
            ) {
                this.drawElevationProfile(this.elevationData);
            }
        }, 350);
    }

    uid() {
        return Math.random().toString(36).slice(2);
    }

    addPoint(lat, lng) {
        const p = { id: this.uid(), lat, lng };
        this.points.push(p);
        const m = L.marker([lat, lng], { draggable: true }).addTo(this.map);
        m.on("click", () => this.removePoint(p.id));
        m.on("dragend", (e) => {
            const pos = e.target.getLatLng();
            p.lat = pos.lat;
            p.lng = pos.lng;
            this.updateList();
            this.clearRoute();
            document.getElementById("results").innerHTML = "";
            this.hideElevationProfile();
        });
        this.markers.push({ id: p.id, marker: m });
        this.updateList();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        this.hideElevationProfile();
    }

    removePoint(id) {
        this.points = this.points.filter((p) => p.id !== id);
        const m = this.markers.find((x) => x.id === id);
        if (m) this.map.removeLayer(m.marker);
        this.markers = this.markers.filter((x) => x.id !== id);
        this.updateList();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";
        this.hideElevationProfile();
    }

    updateList() {
        const listDiv = document.getElementById("list");
        document.getElementById("stopCount").innerText = this.points.length;
        if (this.points.length === 0) {
            listDiv.innerHTML =
                '<div style="text-align: center; padding: 20px; color: var(--ink-soft); font-size: 13px; font-weight: 500;">🌿 Clicca sulla mappa o aggiungi un indirizzo</div>';
            return;
        }
        listDiv.innerHTML = this.points
            .map(
                (p, i) => `
                        <div class="stop-item">
                            <div class="stop-number">${i + 1}</div>
                            <div class="stop-info">
                                <div class="stop-title">Tappa ${i + 1} ${i === 0 ? "🚩" : i === this.points.length - 1 ? "🏁" : ""}</div>
                                <div class="stop-coords">${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°</div>
                            </div>
                            <button class="delete-stop" onclick="app.removePoint('${p.id}')">🗑️</button>
                        </div>
                    `,
            )
            .join("");
    }

    async geocode(addr) {
        const now = Date.now();
        if (now - this.lastNominatim < 1100)
            await new Promise((r) => setTimeout(r, 1100));
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
        this.map.setView([g.lat, g.lng], 13);
    }

    async buildMatrix() {
        const key = JSON.stringify(this.points.map((p) => [p.lat, p.lng]));
        if (this.cache.has(key)) {
            this.matrix = this.cache.get(key);
            return;
        }
        const coords = this.points.map((p) => `${p.lng},${p.lat}`).join(";");
        const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;
        const r = await fetch(url);
        const d = await r.json();
        this.matrix = { durations: d.durations, distances: d.distances };
        this.cache.set(key, this.matrix);
    }

    cost(path, useDistance = false) {
        let s = 0;
        const matrix = useDistance
            ? this.matrix.distances
            : this.matrix.durations;
        for (let i = 1; i < path.length; i++) s += matrix[path[i - 1]][path[i]];
        return s;
    }

    nearestNeighbor(startIndex) {
        const n = this.points.length;
        const visited = new Set();
        let path = [startIndex];
        visited.add(startIndex);
        while (path.length < n) {
            let last = path[path.length - 1];
            let best = -1,
                bestVal = Infinity;
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

    multiStartNN() {
        let bestPath = null,
            bestCost = Infinity;
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

    twoOpt(path) {
        let improved = true;
        let bestPath = [...path];
        while (improved) {
            improved = false;
            for (let i = 1; i < bestPath.length - 2; i++) {
                for (let j = i + 1; j < bestPath.length; j++) {
                    const newPath = bestPath
                        .slice(0, i)
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

    heldKarp() {
        const n = this.points.length;
        const dist = this.matrix.durations;

        const dp = new Map();
        const parent = new Map();

        for (let i = 0; i < n; i++) {
            const key = (1 << i) + "," + i;
            dp.set(key, 0);
        }

        for (let mask = 1; mask < 1 << n; mask++) {
            for (let last = 0; last < n; last++) {
                if (!(mask & (1 << last))) continue;
                const prevMask = mask ^ (1 << last);
                if (prevMask === 0) continue;
                let best = Infinity;
                let bestPrev = -1;
                for (let prev = 0; prev < n; prev++) {
                    if (!(prevMask & (1 << prev))) continue;
                    const key = prevMask + "," + prev;
                    if (!dp.has(key)) continue;
                    const val = dp.get(key) + dist[prev][last];
                    if (
                        val < best &&
                        dist[prev][last] !== null &&
                        dist[prev][last] !== undefined
                    ) {
                        best = val;
                        bestPrev = prev;
                    }
                }
                if (bestPrev !== -1) {
                    dp.set(mask + "," + last, best);
                    parent.set(mask + "," + last, bestPrev);
                }
            }
        }

        const fullMask = (1 << n) - 1;
        let bestCost = Infinity;
        let bestLast = -1;
        for (let last = 0; last < n; last++) {
            const key = fullMask + "," + last;
            if (dp.has(key) && dp.get(key) < bestCost) {
                bestCost = dp.get(key);
                bestLast = last;
            }
        }

        if (bestLast === -1) return null;

        const path = [];
        let mask = fullMask;
        let last = bestLast;
        while (mask > 0) {
            path.push(last);
            const prevMask = mask ^ (1 << last);
            if (prevMask === 0) break;
            const key = mask + "," + last;
            const prev = parent.get(key);
            if (prev === undefined) break;
            last = prev;
            mask = prevMask;
        }
        path.reverse();
        return path;
    }

    async calculate() {
        if (this.points.length < 2) {
            alert("Inserisci almeno 2 tappe");
            return;
        }

        this.showLoading();
        this.clearRoute();
        document.getElementById("results").innerHTML = "";

        try {
            await this.buildMatrix();

            let path = null;
            let algoName = "";

            const n = this.points.length;

            if (n <= this.EXACT_LIMIT) {
                path = this.heldKarp();
                algoName = "Concorde (esatto)";
                if (!path) throw new Error("Errore nel calcolo esatto");
            } else {
                const nnPath = this.multiStartNN();
                path = this.twoOpt(nnPath);
                algoName = "2-Opt + Nearest Neighbor (euristico)";
                if (!path || path.length !== this.points.length)
                    throw new Error("Errore nel calcolo euristico");
            }

            await this.draw(path, algoName);
            this.rebuildMarkers(path);
        } catch (error) {
            alert("Errore: " + error.message);
        } finally {
            this.hideLoading();
        }
    }

    async draw(path, algoName) {
        const coords = path
            .map((i) => `${this.points[i].lng},${this.points[i].lat}`)
            .join(";");
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.routes || d.routes.length === 0)
            throw new Error("Percorso non disponibile");

        const route = d.routes[0];

        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        this.routeLayer = L.geoJSON(route.geometry, {
            style: { color: "#22c55e", weight: 5, opacity: 0.9 },
        }).addTo(this.map);

        const totalDistance = (route.distance / 1000).toFixed(1);
        const totalDuration = Math.round(route.duration / 60);

        document.getElementById("results").innerHTML = `
                        <div class="results-card">
                            <div class="stat-row"><span class="stat-label">📏 Distanza</span><span class="stat-value">${totalDistance} km</span></div>
                            <div class="stat-row"><span class="stat-label">⏱️ Durata</span><span class="stat-value">${totalDuration} min</span></div>
                            <div class="stat-row"><span class="stat-label">📍 Tappe</span><span class="stat-value">${this.points.length}</span></div>
                            <div class="stat-row"><span class="stat-label">✨ Algoritmo</span><span class="stat-value"><span class="algo-badge">${algoName}</span></span></div>
                        </div>
                    `;

        try {
            const elevData = await this.fetchElevationProfile(path);
            this.elevationData = elevData;
            document
                .getElementById("elevationProfile")
                .classList.remove("collapsed");
            this.drawElevationProfile(elevData);
        } catch (err) {
            console.warn("Profilo altimetrico non disponibile:", err);
            this.hideElevationProfile();
        }

        requestAnimationFrame(() => {
            this.map.invalidateSize();
            this.map.fitBounds(this.routeLayer.getBounds());
        });
    }

    async fetchElevationProfile(path) {
        const coords = path
            .map((i) => `${this.points[i].lng},${this.points[i].lat}`)
            .join(";");
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
        const r = await fetch(url);
        const d = await r.json();
        if (!d.routes || d.routes.length === 0)
            throw new Error("Percorso non disponibile");

        const geometry = d.routes[0].geometry;
        const points = geometry.coordinates.map((c) => ({
            lng: c[0],
            lat: c[1],
        }));

        const step = Math.max(1, Math.floor(points.length / 100));
        const sampled = points.filter((_, i) => i % step === 0);

        const elevUrl = "https://api.open-elevation.com/api/v1/lookup";
        const body = {
            locations: sampled.map((p) => ({
                latitude: p.lat,
                longitude: p.lng,
            })),
        };
        const elevR = await fetch(elevUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!elevR.ok) throw new Error("Errore nel recupero altitudini");
        const elevD = await elevR.json();

        let cumulativeDist = 0;
        const distances = [0];
        for (let i = 1; i < sampled.length; i++) {
            const dx = sampled[i].lng - sampled[i - 1].lng;
            const dy = sampled[i].lat - sampled[i - 1].lat;
            cumulativeDist += Math.sqrt(dx * dx + dy * dy) * 111.32;
            distances.push(cumulativeDist);
        }

        const elevations = elevD.results.map((r) => r.elevation);
        return { elevations, distances };
    }

    drawElevationProfile(data) {
        const canvas = this.canvas;
        const ctx = this.ctx;
        const profile = document.getElementById("elevationProfile");
        if (profile.classList.contains("collapsed")) return;

        const wrapRect = this.elevationWrap.getBoundingClientRect();
        const width = Math.max(0, Math.floor(wrapRect.width));
        const height = Math.max(0, Math.floor(wrapRect.height));
        if (width === 0 || height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const padding = { top: 6, bottom: 4, left: 6, right: 6 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const elevs = data.elevations;
        const dists = data.distances;

        const rootStyles = getComputedStyle(document.documentElement);
        const inkSoft =
            rootStyles.getPropertyValue("--ink-soft").trim() || "#52604e";
        const bodyFont =
            rootStyles.getPropertyValue("--font-body").trim() || "sans-serif";

        if (elevs.length < 2) {
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = inkSoft;
            ctx.font = `10px ${bodyFont}`;
            ctx.textAlign = "center";
            ctx.fillText(
                "Dati altimetrici insufficienti",
                width / 2,
                height / 2 + 4,
            );
            return;
        }

        let minElev = Math.min(...elevs);
        let maxElev = Math.max(...elevs);
        const range = maxElev - minElev || 1;

        const isDark = this.isDark;
        const lineColor = isDark ? "#e2803f" : "#c1562f";
        const fillColor = isDark
            ? "rgba(226, 128, 63, 0.2)"
            : "rgba(193, 86, 47, 0.15)";
        const gridColor = isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.05)";
        const textColor = inkSoft;

        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }

        ctx.beginPath();
        const startX = padding.left;
        const startY =
            padding.top +
            chartHeight -
            ((elevs[0] - minElev) / range) * chartHeight;
        ctx.moveTo(startX, startY);
        for (let i = 0; i < elevs.length; i++) {
            const x =
                padding.left +
                (dists[i] / dists[dists.length - 1]) * chartWidth;
            const y =
                padding.top +
                chartHeight -
                ((elevs[i] - minElev) / range) * chartHeight;
            ctx.lineTo(x, y);
        }
        const lastX = padding.left + chartWidth;
        ctx.lineTo(lastX, padding.top + chartHeight);
        ctx.lineTo(startX, padding.top + chartHeight);
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < elevs.length; i++) {
            const x =
                padding.left +
                (dists[i] / dists[dists.length - 1]) * chartWidth;
            const y =
                padding.top +
                chartHeight -
                ((elevs[i] - minElev) / range) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        const totalDist = dists[dists.length - 1];
        const gain = maxElev - minElev;
        document.getElementById("elevationStats").textContent =
            `${totalDist.toFixed(1)} km · ${Math.round(gain)} m dislivello`;
        document.getElementById("elevMin").textContent =
            `${Math.round(minElev)} m`;
        document.getElementById("elevMax").textContent =
            `${Math.round(maxElev)} m`;
    }

    hideElevationProfile() {
        document.getElementById("elevationProfile").classList.add("collapsed");
        this.elevationData = null;
    }

    rebuildMarkers(path) {
        this.markers.forEach((m) => this.map.removeLayer(m.marker));
        this.markers = [];

        path.forEach((i, idx) => {
            const p = this.points[i];
            let iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">${idx + 1}</div>`;
            if (idx === 0)
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">🚩</div>`;
            if (idx === path.length - 1)
                iconHtml = `<div style="background: #22c55e; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">🏁</div>`;

            const icon = L.divIcon({
                className: "custom-marker",
                html: iconHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14],
            });

            const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
            m.bindPopup(
                `Tappa ${idx + 1}${idx === 0 ? " (Partenza)" : idx === path.length - 1 ? " (Arrivo)" : ""}`,
            );
            m.on("click", () => this.removePoint(p.id));
            this.markers.push({ id: p.id, marker: m });
        });
    }

    clearRoute() {
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        this.routeLayer = null;
    }

    reset() {
        this.points = [];
        this.markers.forEach((m) => this.map.removeLayer(m.marker));
        this.markers = [];
        this.clearRoute();
        this.hideElevationProfile();
        this.updateList();
        document.getElementById("results").innerHTML = "";
    }
}

const app = new RoutePlanner();