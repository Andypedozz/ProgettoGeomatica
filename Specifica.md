# Specifica Progetto Geomatica

Realizzare un'applicazione web/mobile per il tracciamento di itinerari multi tappa su una mappa OpenStreetMap.

## Requisiti principali

Azione A: click sinistro del mouse / tocco sullo schermo

* L'utente deve poter visualizzare una mappa OpenStreetMap.
* L'utente deve poter inserire un insieme di tappe con A.
* L'utente deve poter selezionare una tappa di inizio e una di fine da un menu dedicato
* l'utente deve poter rimuovere una tappa tramite A sulla tappa inserita.
* l'utente deve poter visualizzare un profilo altimetrico del percorso tracciato
* l'utente deve poter specificare il mezzo di percorrenza del percorso (auto o piedi)
* l'utente deve poter visualizzare il tempo stimato di percorrenza del percorso.
* l'utente deve poter inserire una tappa anche tramite indirizzo + numero civico

## Requisiti di performance

* L'applicazione deve avere un sistema di cache dei dati utilizzati, in modo da poter funzionare, almeno parzialmente, anche offline
* l'applicazione non deve fare un uso eccessivo di chiamate API (da chiarire)

## Problema Algoritmico Da risolvere
Il problema al centro dell'applicazione è il Traveling Salesman problem (TSP).
