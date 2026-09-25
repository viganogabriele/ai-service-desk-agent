# PRD — AI Ticket Triage Dashboard

## 0. Scopo e perimetro

Costruire la **dashboard** per il triage assistito dei ticket Jira Service Management della
challenge Swiss AI Weeks (vedi `core/README.md`). Un solver AI, fuori dal perimetro di questo documento,
propone la classificazione dei ticket. La dashboard la mostra all'operatore L2, che la verifica,
la modifica, la accetta o la escala. La dashboard mostra anche KPI storici e metriche del solver.

**In perimetro:** UI, lettura e aggregazione dei file dati, gestione dello stato delle review,
export, visualizzazione di proposte, metriche e anomalie prodotte dal solver.

**Fuori perimetro:** implementazione del solver, retrieval, prompt, valutazione su hold-out,
esecuzione batch sullo storico. La dashboard **consuma** questi output secondo i contratti in §3.

**Regola generale:** ogni numero mostrato viene calcolato dai file o letto dagli output del solver.
Niente valori scritti a mano nel codice. Finché il solver non è pronto si usano fixture mock (§3.5),
sempre etichettate come **MOCK** in UI.

---

## 1. Fonti dati

| File | Contenuto |
|---|---|
| `core/jira_first_20000_requested_fields_synthetic.json` | Array di 20.000 ticket storici |
| `core/jira_hackathon_blind_eval_challenge_*.json` | Oggetto con metadati e `records`: 20 ticket incoming |
| `README.md` | Matrice Urgency × Impact → Priority, lista servizi Critical / Non-Critical |

**Campi dei ticket storici:** `Work type`, `Summary`, `Description`,
`Affected Business or IT Services` (array), `Business Entity` (array), `Service Team(s)` (array),
`Reporter`, `Assignee`, `Priority`, `Urgency`, `Impact` (minuscolo: `highest…lowest`),
`Created date`, `Status`, `Resolution`, `Resolution date`, `All Comments` (array di stringhe
`email: testo`).

**Campi dei ticket challenge:** gli stessi (Priority/Urgency/Impact con iniziale maiuscola:
`Highest…Lowest`) più `Request type`, `Linked issues`, `Due date`, `Severity` (sempre null) e
`Business Critical for Entity` (sempre vuoto). `Service Team(s)` è vuoto e `Assignee` è null su
tutti i 20. **Non esiste un campo ID:** si usa l'indice nell'array `records` come `ticket_id`
(`CH-01` … `CH-20`).

---

## 2. Vincoli dai dati (valgono per tutta la UI)

1. **`Status = done` non significa risolto.** I 16.969 `done` si dividono in Resolution `done`
   4.236, `clarification` 4.243, `cancelled` 4.168, `cannot reproduce` 4.322. I 3.031 senza
   Resolution sono `in progress` (2.064) oppure `open` (967).
2. **Priority, Urgency e Impact storici sono casuali** (lo dichiara il README): non si mostrano
   come distribuzioni.
3. **Service → Team è 1:1** (tabella sotto). In UI il Team è sempre derivato dal Service, mai
   editabile a parte.
4. **L'assignee non dipende dal team:** ogni team ha avuto tutti e 30 gli assignee. Il suggerimento
   si presenta come top-3 per frequenza nel team, con conteggio.
5. **Bucket generico:** 5.423 ticket (27%) in `Emailed Support Tickets` / `Service Desk`.
6. **Priority è sempre calcolata** dalla matrice, a partire da Urgency e Impact. Mai input libero.
7. **Normalizzazione etichette:** confronto case-insensitive tra le fonti, visualizzazione con
   iniziale maiuscola.

### 2.1 Tabella Service → Team → Rating

| Service | Team | Rating |
|---|---|---|
| Trading Platform | Investment Operations | Critical |
| Trade Matching | Investment Operations | Critical |
| Portfolio Accounting | Investment Operations | Critical |
| Order Management | Trading Support | Critical |
| Securities Settlement | Securities Operations | Critical |
| Corporate Actions | Securities Operations | Critical |
| Fund Pricing | Valuation & Pricing | Critical |
| NAV Calculation | Valuation & Pricing | Critical |
| Cash Management | Treasury & Cash | Critical |
| Risk & Compliance Monitoring | Risk & Controls | Critical |
| Regulatory Reporting | Risk & Controls | Critical |
| SimCorp Dimension | Enterprise Applications | Critical |
| Rimes Data Feed | Market Data Services | Critical |
| Client Reporting | Client Services | Critical |
| Tax Reporting | Tax & Reporting | Non-Critical |
| CRM & Client Portal | Client Services | Non-Critical |
| Identity & Access Management | Enterprise Applications | Non-Critical |
| SharePoint & File Storage | Enterprise Applications | Non-Critical |
| Outlook & Email | Enterprise Applications | Non-Critical |
| Emailed Support Tickets | Service Desk | Non-Critical |

### 2.2 Matrice Priority e mappatura etichette

Valori dati ↔ label della matrice (entrambi mostrati nei dropdown, es. "Highest — Critical"):

| Valore | Urgency (label matrice) | Impact (label matrice) |
|---|---|---|
| Highest | Critical | Major / Widespread |
| High | High | Significant / Large |
| Medium | Medium | Moderate / Limited |
| Low | Low | Minor / Localized |
| Lowest | Lowest | No direct impact / Information |

Priority = MATRIX[Urgency][Impact]:

| Urgency \ Impact | Highest | High | Medium | Low | Lowest |
|---|---|---|---|---|---|
| **Highest** | Highest | Highest | High | Medium | Medium |
| **High** | Highest | High | High | Medium | Low |
| **Medium** | High | High | Medium | Low | Low |
| **Low** | Medium | Medium | Low | Low | Lowest |
| **Lowest** | Medium | Low | Low | Lowest | Lowest |

Tabella, mappatura e lista servizi vanno definite **una sola volta** in un modulo condiviso.

---

## 3. Contratti dati in input (prodotti dal solver)

La dashboard legge questi file o endpoint. Se mancano, usa le fixture mock (§3.5).

### 3.1 Proposta per ticket challenge

```json
{
  "ticket_id": "CH-01",
  "model_id": "local-v1",
  "generated_at": "2026-09-24T10:00:00Z",
  "latency_ms": 2300,
  "cost_chf": 0.0,
  "proposal": {
    "work_type": "Service Request",
    "service": "Tax Reporting",
    "assignee_candidates": [
      { "email": "gina.muller@intcom.com", "historical_count": 32 }
    ],
    "urgency": "Low",
    "impact": "Low",
    "resolution": "done",
    "resolution_comment": "gina.muller@intcom.com: License assigned for ..."
  },
  "confidence": { "work_type": 0.92, "service": 0.81 },
  "rationale": "Il titolo indica un incident, ma la descrizione chiede una licenza aggiuntiva.",
  "similar_tickets": [
    {
      "historical_index": 1234,
      "summary": "...",
      "service": "Tax Reporting",
      "resolution": "done",
      "last_comment": "...",
      "similarity": 0.87
    }
  ]
}
```

- `team` e `priority` **non** fanno parte del contratto: li calcola la dashboard (§2).
- Il solver può proporre `urgency` e `impact` diversi da quelli originali.

### 3.2 Endpoint del solver (interfaccia)

| Operazione | Input | Output |
|---|---|---|
| Solve | `ticket_id`, `model_id` | Proposta §3.1 |
| Regenerate | `ticket_id`, `model_id` (premium), `hint` (testo operatore) | Proposta §3.1 |

La dashboard deve funzionare anche in modalità **solo file**: proposte pre-calcolate, con
Regenerate disabilitato e un tooltip che spiega il motivo.

### 3.3 Metriche dei modelli

```json
{
  "models": [
    {
      "model_id": "local-v1",
      "label": "Local model",
      "kind": "local",
      "latency_ms_p50": 2100,
      "latency_ms_p95": 4800,
      "cost_chf_per_ticket": 0.0,
      "cost_note": "GPU locale, costo energia escluso",
      "holdout": {
        "n": 1000,
        "accuracy": { "service": 0.83, "work_type": 0.95, "team": 0.86 },
        "confusion_service": [
          { "true": "Fund Pricing", "pred": "NAV Calculation", "count": 14 }
        ]
      }
    }
  ]
}
```

Qualsiasi campo può mancare: in quel caso la UI mostra "non misurato", mai 0.

### 3.4 Anomalie storiche

```json
{
  "generated_at": "...",
  "model_id": "local-v1",
  "sample_size": 1000,
  "population_size": 20000,
  "anomalies": [
    {
      "historical_index": 42,
      "type": "generic_bucket | service_mismatch | poor_resolution",
      "recorded_service": "Emailed Support Tickets",
      "predicted_service": "Rimes Data Feed",
      "confidence": 0.88,
      "evidence": "frase da Description/Comments che motiva il cambio",
      "proposed_resolution_comment": "solo per poor_resolution"
    }
  ]
}
```

### 3.5 Fixture mock

- Proposte mock per i 20 ticket challenge. Devono rispettare i vincoli: servizi dalla tabella,
  Resolution tra i 4 valori ammessi, formato del commento `email: testo`.
- Metriche e anomalie mock minimali.
- Banner **"MOCK DATA"** visibile in ogni vista che usa fixture.
- Si passa ai dati reali sostituendo i file o configurando l'endpoint, senza toccare la UI.

---

## 4. Stato gestito dalla dashboard

**Stato review per ticket challenge:**
`to_process | proposed | in_review | accepted | modified_accepted | escalated | clarification_requested`.

**Action log (append-only):** `ticket_id`, `action`, `timestamp`, `model_id`, `changed_fields`
(campo, valore proposto → valore finale), `hint` (per Regenerate), `escalation_reason`
(per Escalate).

**Valori finali:** la risposta finale per ogni ticket, usata dall'export.

Lo stato deve **persistere** tra un reload e l'altro, e serve un comando "reset demo" che lo azzera.

---

## 5. Feature

| # | Feature | Fase |
|---|---|---|
| F1 | KPI storici | 1 — Base |
| F2 | Stato challenge + lista ticket | 1 — Base |
| F3 | Scheda ticket (triage view) | 1 — Base |
| F4 | Azioni sul ticket + export | 1 — Base |
| F5 | Distribuzioni | 2 |
| F6 | Confronto modelli | 2 |
| F7 | Throughput, qualità, unit economics | 2 |
| F8 | Historical anomaly analyzer (vista) | 3 |
| F9 | Selector locale / premium | 3 |

La **fase 1** è la base minima da consegnare funzionante. Le fasi 2–3 si aggiungono sopra senza
riscrivere nulla.

### F1 — KPI storici

Card calcolate dal file storico:
- Totale ticket: **20.000**.
- Status: **16.969** done / **2.064** in progress / **967** open.
- Done scomposto per Resolution: done 4.236 / clarification 4.243 / cancelled 4.168 /
  cannot reproduce 4.322 (barra impilata).
- Work type: **16.000** Incident / **4.000** Service Request.
- Ticket nel bucket generico: **5.423** (27%).
- Incoming challenge: **20** (13 Incident / 7 Service Request dichiarati), tutti open, nessun team
  né assignee.

**Accettazione:** i valori coincidono con quelli qui sopra, calcolati a runtime o in preprocessing.

### F2 — Stato challenge + lista ticket

- Contatori per stato review (§4) e barra di avanzamento `accettati / 20`. "Accettati" conta
  `accepted` e `modified_accepted`.
- Tabella dei 20 ticket con: `ticket_id`, Summary, `Request type`, Service dichiarato → proposto
  (freccia se diversi), Work type dichiarato → proposto, Priority proposta, confidenza Service,
  stato review.
- Filtri: stato review, service proposto, Critical / Non-Critical, "work type cambiato",
  "service cambiato".
- Ordinamento di default: prima i non processati, poi confidenza crescente.
- Click su una riga → scheda ticket (F3).

### F3 — Scheda ticket (triage view)

Layout su due colonne.

**Sinistra, originale in sola lettura:**
Summary, Description, All Comments (una riga per commento, autore separato dal testo),
`Request type`, Business Entity, Reporter, Created date, Due date, Linked issues, e i valori
dichiarati di Work type, Service, Urgency, Impact, Priority.

**Destra, proposta modificabile:**

| Campo | Controllo | Regola |
|---|---|---|
| Work type | toggle | `Incident` / `Service Request`, badge "cambiato" se ≠ originale |
| Service | dropdown | I 20 servizi (§2.1), con tag Critical / Non-Critical |
| Team | readonly | Derivato dal Service, si aggiorna in tempo reale |
| Assignee | dropdown | Prima le `assignee_candidates` con conteggio, poi l'elenco completo dei 30 assignee storici |
| Urgency | dropdown | Highest…Lowest con la label della matrice |
| Impact | dropdown | Highest…Lowest con la label della matrice |
| Priority | readonly | Calcolata con §2.2, mini-matrice 5×5 con la cella attiva evidenziata |
| Resolution | dropdown | `done` / `cancelled` / `clarification` / `cannot reproduce` |
| Resolution comment | textarea | Precompilato. Il prefisso `email:` si aggiorna se cambia l'assignee. |

**Pannelli sotto la proposta:**
- **Confidenza** di Work type e Service: badge alta (≥ 0.8) / media (0.5–0.8) / bassa (< 0.5).
- **Motivazione** (`rationale`).
- **Diff vs originale:** elenco dei campi cambiati, `originale → proposto`.
- **Ticket simili:** fino a 3 card con Summary, Service, Resolution, ultimo commento e similarità.
  Click → modale con il ticket storico completo.
- **Warning** calcolati dalla dashboard:
  - service Critical con Priority Low o Lowest;
  - resolution comment generico: meno di 40 caratteri, oppure contiene solo "fixed" /
    "problem fixed" / "resolution recorded";
  - `Request type = Nonsense / Unclear Input` e Resolution ≠ `clarification`;
  - Assignee vuoto.

**Accettazione:** non esiste modo, da UI, di salvare un ticket con Team incoerente col Service o
Priority incoerente con la matrice.

### F4 — Azioni sul ticket + export

| Azione | Effetto sullo stato | Note |
|---|---|---|
| Accetta | `accepted` | Salva la proposta così com'è |
| Modifica e accetta | `modified_accepted` | Attivo solo se c'è almeno un campo cambiato. Registra `changed_fields`. |
| Rigenera con modello migliore | torna a `proposed` | Hint obbligatorio, chiama Regenerate (§3.2), conserva la proposta precedente consultabile |
| Escala | `escalated` | Motivo obbligatorio: servizio incerto / info insufficienti / possibile incidente critico / altro (testo) |
| Chiedi chiarimento | `clarification_requested` | Imposta Resolution = `clarification` e precompila un commento-domanda al reporter |
| Annulla | stato precedente | Undo dell'ultima azione sul ticket |

- Navigazione "ticket successivo da processare" dopo ogni azione.
- **Export** dei 20 ticket come JSON con la stessa struttura dei `records` della challenge, con i
  campi finali compilati (`Work type`, `Affected Business or IT Services`, `Service Team(s)`,
  `Assignee`, `Urgency`, `Impact`, `Priority`, `Resolution`, `All Comments` + resolution comment).
  I ticket non accettati si esportano con la proposta corrente e un flag
  `reviewed: false` nell'export.

### F5 — Distribuzioni (storico)

- Ticket per **Service** (20 barre, colore Critical / Non-Critical).
- Ticket per **Team** (11 barre).
- Ticket per **Business Entity** (5 barre).
- Ticket per **Status** e per **Resolution**.
- Filtro incrociato: la selezione di un Service o di un Team filtra le altre viste.
- **Vietato:** grafici di Priority, Urgency e Impact storici.

### F6 — Confronto modelli

Tabella da §3.3, una riga per modello: latenza p50 e p95, costo per ticket, accuracy hold-out su
Service, Work type e Team, con dimensione `n` del hold-out.
- Nota fissa in UI: "Accuracy misurata su hold-out del training. Assignee, Priority e
  Resolution text non sono valutati per mancanza di ground truth."
- Campo mancante → "non misurato".

### F7 — Throughput, qualità, unit economics

**Dalla demo (action log §4):**
- Numero e percentuale di ticket accettati senza modifiche / modificati / escalati / rigenerati /
  in chiarimento.
- Per campo: percentuale di volte in cui l'operatore **non** ha cambiato la proposta
  (tasso di accettazione per campo).
- Elenco delle correzioni più frequenti (es. Service X → Y).

**Dal solver (§3.3):**
- Matrice di confusione dei Service sul hold-out (heatmap 20×20) e top-5 coppie confuse.

**Unit economics** (calcolatore):
- Input: modello (da §3.3), volume giornaliero, minuti di triage manuale risparmiati per ticket,
  costo orario L2.
- Default del volume: calcolato dalle `Created date` dello storico (ticket / giorno nel range).
- Output: costo al giorno / mese / anno, tempo di elaborazione totale, ore L2 risparmiate.
  Scenari a 1× e 10× il volume.
- Tutte le ipotesi sono visibili ed editabili, e i default sono etichettati come ipotesi.

### F8 — Historical anomaly analyzer (vista)

Legge §3.4. Tre tab, una per `type`:
1. **Bucket generico:** ticket in `Emailed Support Tickets` con il service proposto e la confidenza,
   più un grafico "dove finirebbero" (conteggio per `predicted_service`).
2. **Service incompatibile:** recorded → predicted, confidenza, `evidence` evidenziata nel testo.
3. **Resolution inutili:** commento originale accanto al `proposed_resolution_comment`.

- Per ogni tab: conteggio, filtro per service e confidenza minima, click → modale del ticket storico.
- Riepilogo in testa: campione analizzato (`sample_size` / `population_size`) e percentuale di
  anomalie per tipo, **con estrapolazione esplicitamente marcata come tale**.

### F9 — Selector locale / premium

- Toggle globale popolato dai `models` di §3.3. Si mostra solo se ci sono almeno 2 modelli con
  metriche misurate.
- Aggiorna F6, F7 e il modello usato per "Solve".
- "Rigenera con modello migliore" (F4) usa sempre il modello con `kind: premium`, a prescindere
  dal toggle.

---

## 6. Requisiti trasversali

- **Lingua UI:** inglese, perché i contenuti dei ticket sono in inglese.
- **Performance:** il file storico pesa circa 25 MB. Aggregazioni e indici (per `historical_index`)
  vanno calcolati una volta, non a ogni render.
- **Stati vuoti:** ogni vista che dipende da §3 gestisce "dato non disponibile" con un messaggio
  chiaro, senza errori.
- **Demo-friendly:** reset demo, nessun login, avvio con un solo comando.

## 7. Fuori perimetro

- Implementazione del solver, del retrieval e della valutazione.
- KPI o grafici su Priority, Urgency e Impact storici.
- Tempi di risoluzione / SLA per team.
- Accuracy dell'Assignee come metrica.
- Qualsiasi metrica non calcolata dai file o non fornita dal solver.
