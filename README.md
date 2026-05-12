# 📍 Ottimizzazione Percorsi Multi-Tappa (TSP su rete stradale reale)

## 📌 Descrizione del progetto

Questo progetto è una applicazione web sviluppata in **HTML, JavaScript e Leaflet** che permette di:

* Inserire più tappe su una mappa interattiva
* Calcolare il percorso ottimale tra i punti (problema del **Traveling Salesman Problem - TSP**)
* Utilizzare dati reali di strade e tempi di percorrenza
* Visualizzare il percorso direttamente su mappa OpenStreetMap

Il sistema sfrutta servizi esterni gratuiti per:

* Geocoding degli indirizzi (OpenStreetMap Nominatim)
* Calcolo dei percorsi stradali (OSRM - Open Source Routing Machine)

---

## 🧭 Funzionalità principali

### 📍 Inserimento tappe

È possibile aggiungere punti in due modi:

* Inserendo un indirizzo testuale
* Cliccando direttamente sulla mappa

Ogni punto viene memorizzato come tappa del percorso.

---

### 🚗 Modalità di viaggio

Puoi scegliere tra:

* 🚗 Auto (`driving`)
* 🚶 A piedi (`walking`)

---

### 🧠 Algoritmi di ottimizzazione

Il programma supporta due strategie:

#### 1. Nearest Neighbor

* Algoritmo veloce e approssimato
* Sceglie sempre la tappa più vicina successiva
* Buon compromesso tra velocità e qualità

#### 2. Brute Force

* Calcola tutte le permutazioni possibili
* Trova il percorso ottimale reale
* Limitato a massimo ~8 tappe (per complessità computazionale)

---

### 🗺️ Visualizzazione del percorso

* Disegno del percorso sulla mappa
* Ordinamento numerico delle tappe
* Evidenziazione:

  * 🟢 Punto di partenza
  * 🔴 Punto di arrivo
  * 🔵 tappe intermedie

---

## ⚙️ Come funziona

1. L’utente inserisce o seleziona le tappe
2. Il sistema costruisce una **matrice dei tempi reali** tra tutti i punti usando OSRM
3. Viene applicato l’algoritmo scelto (Nearest Neighbor o Brute Force)
4. Il percorso ottimizzato viene richiesto a OSRM
5. Il risultato viene disegnato sulla mappa Leaflet

---

## 🚀 Come usare il progetto

### 1. Requisiti

Non è necessario installare nulla, basta un browser moderno.

### 2. Avvio

Apri il file:

```
index.html
```

nel tuo browser.

---

### 3. Utilizzo

* Inserisci un indirizzo oppure clicca sulla mappa
* Ripeti per aggiungere più tappe
* Seleziona:

  * modalità di trasporto
  * algoritmo di ottimizzazione
* Premi **"Calcola percorso"**

---

## 🌐 API utilizzate

### 📍 Geocoding

* OpenStreetMap Nominatim
  [https://nominatim.openstreetmap.org](https://nominatim.openstreetmap.org)

### 🛣️ Routing

* OSRM Public API
  [https://router.project-osrm.org](https://router.project-osrm.org)

---

## ⚠️ Limitazioni

### ⏱️ Performance

* Il calcolo della matrice dei tempi è **O(n²)** richieste HTTP
* Con molte tappe il sistema diventa lento

---

### 🧠 Algoritmo brute force

* Ha complessità **O(n!)**
* Utilizzabile solo fino a ~8 punti

---

### 🌍 Dipendenza da servizi esterni

Il sistema dipende completamente da API pubbliche:

* Nominatim può avere limiti di rate
* OSRM pubblico può essere lento o non sempre disponibile

---

### 📡 Nessuna cache

* Ogni calcolo rigenera la matrice dei tempi
* Non viene salvata alcuna informazione localmente

---

### 🛰️ Precisione dei dati

* I tempi di percorrenza sono stimati
* Non considerano traffico in tempo reale

---

## 💡 Possibili miglioramenti futuri

* Cache della matrice delle distanze
* Supporto a più algoritmi (Genetic Algorithm, Simulated Annealing)
* Backend dedicato per ridurre chiamate API
* Ottimizzazione per grandi dataset
* Supporto export del percorso (GPX / KML)

---

## 📄 Licenza

Progetto didattico e sperimentale basato su tecnologie open source:

* OpenStreetMap
* Leaflet
* OSRM

---