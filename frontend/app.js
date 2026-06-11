const API_URL = 'http://localhost:3000/api/tsp';

class RoutePlanner {
	constructor() {
		this.map = L.map('map').setView([43.7, 12.6], 7);

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution: '© OpenStreetMap contributors'
		}).addTo(this.map);

		this.points = [];
		this.markers = [];
		this.matrix = null;
		this.routeLayer = null;

		this.map.on('click', e => {
			this.addPoint(e.latlng.lat, e.latlng.lng);
		});
	}

	setLoading(show) {
		document.getElementById('loading').style.display = show ? 'block' : 'none';
	}

	uid() {
		return Math.random().toString(36).slice(2);
	}

	addPoint(lat, lng) {
		const p = { id: this.uid(), lat, lng };
		this.points.push(p);

		const m = L.marker([lat, lng]).addTo(this.map);
		m.on('click', () => this.removePoint(p.id));

		this.markers.push({ id: p.id, marker: m });
		this.updateList();
		this.clearRoute();
	}

	removePoint(id) {
		this.points = this.points.filter(p => p.id !== id);

		const m = this.markers.find(x => x.id === id);
		if (m) this.map.removeLayer(m.marker);

		this.markers = this.markers.filter(x => x.id !== id);

		this.updateList();
		this.clearRoute();
	}

	updateList() {
		const listDiv = document.getElementById('list');
		listDiv.innerHTML = this.points.map((p, i) =>
			`<div class="stop">Tappa ${i + 1}</div>`
		).join('');
	}

	async addByAddress() {
		const addr = document.getElementById('addr').value;
		if (!addr) return;

		try {
			const response = await fetch(`${API_URL}/geocode`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: addr })
			});

			if (!response.ok) throw new Error('Geocoding failed');

			const coords = await response.json();
			this.addPoint(coords.lat, coords.lng);
			this.map.setView([coords.lat, coords.lng], 13);

		} catch (error) {
			console.error(error);
			alert('Indirizzo non trovato');
		}
	}

	async buildMatrix() {
		const mode = document.getElementById('mode').value;

		try {
			const response = await fetch(`${API_URL}/matrix`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					points: this.points.map(p => ({ lat: p.lat, lng: p.lng })),
					mode
				})
			});

			const data = await response.json();
			this.matrix = data.matrix;

		} catch (error) {
			console.error(error);
			throw new Error('Errore nel calcolo della matrice');
		}
	}

	cost(path) {
		let sum = 0;
		for (let i = 1; i < path.length; i++) {
			sum += this.matrix[path[i - 1]][path[i]];
		}
		return sum;
	}

	nearestNeighbor(startIndex) {
		const n = this.points.length;
		const visited = new Set();
		const path = [startIndex];
		visited.add(startIndex);

		while (path.length < n) {
			let last = path[path.length - 1];
			let best = -1;
			let bestVal = Infinity;

			for (let i = 0; i < n; i++) {
				if (visited.has(i)) continue;
				if (this.matrix[last][i] < bestVal) {
					bestVal = this.matrix[last][i];
					best = i;
				}
			}

			visited.add(best);
			path.push(best);
		}

		return path;
	}

	multiStartNN() {
		let bestPath = null;
		let bestCost = Infinity;

		for (let i = 0; i < this.points.length; i++) {
			const path = this.nearestNeighbor(i);
			const cost = this.cost(path);
			if (cost < bestCost) {
				bestCost = cost;
				bestPath = path;
			}
		}

		return bestPath;
	}

	twoOpt(path) {
		let improved = true;
		let currentPath = [...path];

		while (improved) {
			improved = false;

			for (let i = 1; i < currentPath.length - 2; i++) {
				for (let j = i + 1; j < currentPath.length; j++) {
					const newPath = currentPath.slice(0, i)
						.concat(currentPath.slice(i, j + 1).reverse())
						.concat(currentPath.slice(j + 1));

					if (this.cost(newPath) < this.cost(currentPath)) {
						currentPath = newPath;
						improved = true;
					}
				}
			}
		}

		return currentPath;
	}

	async calculate() {
		if (this.points.length < 2) {
			alert('Minimo 2 tappe richieste');
			return;
		}

		this.setLoading(true);
		this.clearRoute();

		try {
			await this.buildMatrix();

			const algo = document.getElementById('algo').value;
			let path;

			if (algo === 'nn') {
				path = this.multiStartNN();
			} else {
				path = this.twoOpt(this.multiStartNN());
			}

			await this.drawRoute(path);
			this.rebuildMarkers(path);

			const totalCost = this.cost(path);
			const hours = Math.floor(totalCost / 3600);
			const minutes = Math.floor((totalCost % 3600) / 60);

			const resultDiv = document.getElementById('result');
			resultDiv.style.display = 'block';
			resultDiv.innerHTML = `<strong>Durata totale:</strong> ${hours}h ${minutes}m`;

		} catch (error) {
			console.error(error);
			alert('Errore nel calcolo del percorso');
		} finally {
			this.setLoading(false);
		}
	}

	async drawRoute(order) {
		const mode = document.getElementById('mode').value;

		try {
			const response = await fetch(`${API_URL}/route`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					points: this.points.map(p => ({ lat: p.lat, lng: p.lng })),
					mode,
					order
				})
			});

			const data = await response.json();

			if (this.routeLayer) this.map.removeLayer(this.routeLayer);

			this.routeLayer = L.geoJSON(data.routes[0].geometry, {
				style: { color: 'blue', weight: 5 }
			}).addTo(this.map);

			this.map.fitBounds(this.routeLayer.getBounds());

		} catch (error) {
			console.error(error);
			throw new Error('Errore nel disegno del percorso');
		}
	}

	rebuildMarkers(order) {
		this.markers.forEach(m => this.map.removeLayer(m.marker));
		this.markers = [];

		order.forEach((idx, pos) => {
			const p = this.points[idx];

			const icon = L.divIcon({
				className: 'marker ' + (pos === 0 ? 'start' : pos === order.length - 1 ? 'end' : ''),
				html: `<div>${pos + 1}</div>`
			});

			const m = L.marker([p.lat, p.lng], { icon }).addTo(this.map);
			this.markers.push({ id: p.id, marker: m });
		});
	}

	clearRoute() {
		if (this.routeLayer) this.map.removeLayer(this.routeLayer);
		document.getElementById('result').style.display = 'none';
	}

	reset() {
		this.points = [];
		this.markers.forEach(m => this.map.removeLayer(m.marker));
		this.markers = [];
		this.clearRoute();
		this.updateList();
	}
}

const app = new RoutePlanner();