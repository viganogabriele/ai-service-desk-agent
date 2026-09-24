# Rizzo Flow, Apertus e classificazione dei ticket

Conversazione esportata da **Training aggiuntivo modello**. I messaggi sono riportati in ordine cronologico; sono stati esclusi soltanto frammenti vocali esplicitamente identificati come rumore e la richiesta tecnica di esportazione.

---

## Utente

https://github.com/Rizzo-AI-Academy/rizzo-flow

## Assistente

Ho aperto il repository [Rizzo-AI-Academy/rizzo-flow](https://github.com/Rizzo-AI-Academy/rizzo-flow).

È interessante: è sostanzialmente un’alternativa **open-source e local-first a Jev/System One**. Invece di far generare testo all’LLM, trasforma ogni domanda in una scelta discreta e legge direttamente i **logit delle opzioni**, ottenendo `boolean`, `choice`, `score` o valori numerici con probabilità. Quindi **0 output token** e niente parsing JSON.

Tra l’altro espone un endpoint compatibile con Jev (`/v1/systemone`), quindi è particolarmente rilevante per il discorso che stavamo facendo sulla **classificazione/prioritizzazione delle email senza API cloud costose**. Gira tramite `llama.cpp`, di default con Spark-X2.5-4B, anche completamente in locale.

Se vuoi, posso analizzare **quanto sarebbe adatto concretamente al tuo caso email (categoria + priorità + azioni)** e confrontarlo con Jev in termini di accuratezza, latenza e requisiti hardware.

---

## Utente

È possibile fare post-training o qualche sorta di training aggiuntivo su questo modello, su un modello simile, tale che possiamo dargli delle specifiche istruzioni e un data set di 20.000 tickets in entrata

## Assistente

Direi di sì: con 20k ticket, un 4B come Spark-X2.5 si presta bene a un fine-tuning leggero tipo LoRA. Non serve allenare tutto il modello: bastano adapter piccoli e ti porti dentro le regole e la tassonomia della tua organizzazione. L’output finale lo leggi poi via logit con Rizzo Flow, esattamente come faresti con System One. E terrei fuori dal training un bel pezzo di quei ticket, magari un paio di mila, per capire quanto davvero stai migliorando rispetto al modello base. Se mi dici che colonne esatte hai nei 20k, ti dico anche come li strutturerei per il fine-tuning.

---

## Utente

Conosci le AI svizzera Apertus

## Assistente

Trovato. Apertus è il modello svizzero rilasciato da ETH Zurich, EPFL e CSCS; completamente open, licenza Apache 2.0, modificabile e utilizzabile anche commercialmente. La prima release era in 8B e 70B. Poi è uscito Apertus 1.5 con reasoning migliorato e capacità multimodali, più una famiglia "Apertus Mini" pensata anche per hardware limitato. Se vuoi, possiamo valutare se una delle versioni Mini è adatta a Rizzo Flow e stimare il costo di un LoRA sul vostro dataset. Ti va se ci concentriamo su quello?

---

## Utente

Sì, controlla quello e anche 1.5

## Assistente

Allora, per i vostri 20.000 ticket e la pipeline stile Rizzo Flow, i candidati sensati sono Apertus Mini 4B Instruct e Apertus 1.5 8B. Il 70B è fuori scala per questa attività.

---

## Utente

Va bene, e posso usare un Mac mini M4 come training?

## Assistente

Un Mac mini M4 può andare, ma con compromessi. Se hai 16 GB di RAM, io starei su un 1.5B.

---

## Utente

No, ventiquattro.

## Assistente

Con 24 GB sul 4B cominci a starci, ma non sarà velocissimo. Per Apertus 1.5 8B io eviterei su quell’hardware. Se vuoi, ti faccio una stima dei tempi sui vostri 20k ticket.

---

## Utente

https://github.com/Swiss-ai-Weeks/SwissLife-2026/tree/main

Puoi trovare il file da ventimila ticket in quest'area.

## Assistente

Il repository sembra non essere indicizzato/accessibile correttamente dal browser web che sto usando, quindi non riesco ancora a vedere l’albero dei file e identificare con certezza il dataset da ~20.000 ticket.

[SwissLife-2026 su GitHub](https://github.com/Swiss-ai-Weeks/SwissLife-2026/tree/main)

Se mi dai il link diretto alla cartella/file dei dati (oppure il nome del file), posso analizzarlo e ricavare subito **numero di ticket, colonne, lunghezza media/percentili dei testi e token**, e da questi stimare realisticamente **tempo e RAM per LoRA/QLoRA di Apertus su Mac mini M4 24 GB**.

---

## Utente

https://raw.githubusercontent.com/Swiss-ai-Weeks/SwissLife-2026/refs/heads/main/jira_first_20000_requested_fields_synthetic.json

## Assistente

Sì, **è esattamente il dataset da 20.000 ticket** che intendevi. Il file è oltre i 4 MB, infatti il reader web non riesce a caricarlo direttamente per il limite di dimensione.

Per fare la stima seria che stavamo discutendo devo analizzare il JSON localmente: lunghezza media dei ticket, distribuzione, campi target e soprattutto **numero di token effettivamente usati per esempio**.

Se me lo **carichi direttamente qui come file**, posso calcolare precisamente:

- dimensione e struttura dei 20k esempi;
- token medi / mediani / P95;
- come trasformarli in dataset supervisionato;
- **Apertus Mini vs Apertus 1.5 8B**;
- LoRA/QLoRA fattibile su **Mac mini M4 24 GB**;
- RAM richiesta, batch size e tempi per 1/2/3 epoch;
- quanto training ha senso fare rispetto a usare semplicemente Rizzo Flow + prompting.

Quest'ultimo punto è particolarmente importante: con 20k esempi di classificazione potremmo scoprire che **fine-tunare un LLM generativo non è neanche l'approccio migliore**.

---

## Utente

[Carica il file `jira_first_20000_requested_fields_synthetic.json`.]

## Assistente

Perfetto: il file è leggibile. È effettivamente il dataset completo da **20.000 ticket**.

Prime statistiche reali:

- 20.000 record, 16 campi.
- `Summary`: ~7 parole in media.
- `Description`: ~40 parole, P95 ~46.
- `All Comments`: ~37 parole in media, P95 ~72.
- Quindi un ticket completo è relativamente corto: grossomodo **100–200 token di contenuto utile**, a seconda di quali campi includiamo.
- Target interessanti: `Service Team(s)` ha **11 valori**, `Assignee` 30, `Priority/Urgency/Impact` 5 ciascuno, `Work type` 2.
- Il dataset però è **molto sintetico/ripetitivo**: ci sono solo **173 Summary unici e 173 Description uniche** su 20.000 record. Questo è importantissimo per impostare correttamente train/test.

Per un modello ~4B con LoRA/QLoRA via MLX, il Mac mini M4 24 GB dovrebbe essere una piattaforma ragionevole. Un 8B diventa più stretto e lento, ma non lo escluderei a priori con quantizzazione + LoRA.

Farei:

**Apertus / piccolo LLM → fine-tuning sui ticket → Rizzo Flow/logit classification → campi strutturati**

In questo modo il modello impara *il vostro dominio* dai 20k esempi, mentre Rizzo Flow forza le decisioni nei valori consentiti.

C'è però un problema metodologico importante: **non possiamo fare uno split casuale dei 20k**, perché finiremmo quasi sicuramente con varianti degli stessi 173 template sia nel training sia nel test, ottenendo accuracy artificialmente altissime.

Prima di parlare di ore di training, conviene analizzare **come sono generati questi 173 template e quanto effettivamente variano i 20.000 record**. Da quello possiamo decidere se fine-tuning Apertus Mini/1.5 abbia davvero senso e preparare uno split corretto.

---

## Utente

Fai un'analisi completa di qual è il miglior approccio in questo caso e dimmi quanto ci metterebbe il mio computer a runnarlo.

## Assistente

Ho analizzato il dataset da 20.000 ticket in modo abbastanza approfondito e il risultato cambia parecchio la strategia suggerita prima.

## Conclusione

**Non farei fine-tuning sui 20.000 ticket così come sono.** In questo caso rischierebbe addirittura di peggiorare il modello.

Per questo challenge farei:

**regole + retrieval sui 20k + classificazione a logit con un 4B + generazione solo dove serve.**

Il fine-tuning lo terrei come esperimento successivo, usando un dataset **ripulito e ribilanciato di ~1–3k esempi**, non i 20k originali.

### Perché

| Proprietà | Risultato |
|---|---:|
| Ticket | 20.000 |
| `Summary` differenti | **173** |
| `Description` differenti | **173** |
| pattern semantici reali Summary+Description | **11** |
| servizi | 20 |
| team | 11 |
| assignee | 30 |
| testo medio completo | ~84 parole |
| P95 | ~117 parole |

Eliminando il nome del servizio dai testi, i 20.000 ticket collassano praticamente in **11 template**: New license, Access request, Access removal, generic service request, misclassified request, machine alert, human incident, email warning, unclear incident, ecc.

Quindi i 20k non contengono 20k esempi semanticamente indipendenti: sono soprattutto variazioni di **11 archetipi × servizi × entità × dati casuali**.

Inoltre, `Priority`, `Urgency` e `Impact` nel training sono casuali e indipendenti dal contenuto. Le prove sul file mostrano:

- `Service → Team`: **100% deterministico**.
- Work type / Service / Team sono deterministici all'interno dei template.
- Assignee con `service + entity + reporter + request family`: **3,3% accuracy**; il caso con 30 persone è **3,3%**.
- Anche usando tutto il testo e i commenti, Assignee arriva solo a **3,66%**.
- Resolution sui ~17k ticket risolti: **26,2%**, praticamente il 25% casuale fra quattro valori.

Quindi **Assignee e Resolution non contengono praticamente segnale supervisionato sfruttabile**.

### Architettura

**ticket → normalizzazione → decisioni LLM → regole deterministiche → retrieval → output**

1. **Work Type:** classificazione `Incident | Service Request` usando Request type, Summary, Description e Comments. Un 4B è sufficiente; non serve training.
2. **Affected Service:** scelta tra 20 opzioni via logits, con retrieval TF-IDF/BM25 dei ticket storici come contesto secondario.
3. **Service Team:** nessuna AI; semplice mapping deterministico `service → team`.
4. **Urgency + Impact → Priority:** ignorare i label del training; due decisioni LLM basate sulle definizioni ufficiali, poi `priority = PRIORITY_MATRIX[urgency][impact]`.
5. **Assignee:** nearest historical tickets, stesso service, request family ed entity, con weighted vote e confidence bassa.
6. **Resolution:** ragionamento semantico del modello tra `done | cancelled | clarification | cannot reproduce`, non training sui label rumorosi.
7. **Resolution comment:** RAG sui 5–10 ticket simili, selezione di 2–3 esempi concreti e generazione della nota.

### Modello

Sul **Mac mini M4 24 GB**, due strade:

- **Più semplice per l'hackathon:** `Rizzo Flow + Spark-X2.5-4B Q8`, pensato per decisioni discrete con condivisione della KV cache.
- **Se vuoi Apertus:** **Apertus v1.1 Mini 4B Instruct INT4**, non Apertus 1.5 8B. Per le classi, uno scorer diretto: opzioni A–T, forward pass, logits e softmax, senza generare il nome del servizio.

### Tempi stimati sul Mac mini M4 24 GB

| Operazione | M4 24 GB |
|---|---:|
| parsing/indexing 20k ticket | pochi secondi |
| TF-IDF/BM25 retrieval | millisecondi/ticket |
| classificazioni 4B di un ticket | ~0,8–2 s |
| classificare tutti i 20 challenge ticket | ~20–60 s |
| resolution text per ticket | ~2–5 s |
| **pipeline completa sui 20 ticket** | **~1–3 minuti** |

Il Mac è quindi più che sufficiente per eseguire la soluzione.

### Se volessimo comunque fare training

Un riferimento per QLoRA 4-bit di un 4B su M4 24 GB è circa **5,3 secondi/step**. Con batch 2, 20.000 esempi richiedono 10.000 step/epoch:

- **Apertus Mini 4B QLoRA, raw 20k:** ~10–15 ore/epoch; due epoch ~20–30 ore.
- **Apertus 1.5 8B:** probabilmente ~18–30 ore/epoch, con meno margine sui 24 GB.
- **1.000–3.000 esempi curati:** ~45 minuti–2,5 ore/epoch; due epoch grossomodo **2–5 ore**.

Per l'hackathon costruirei prima:

**Rizzo/Spark 4B → Work Type + Service + Urgency + Impact + Resolution**  
**regole → Team + Priority**  
**TF-IDF/BM25 → ticket storici simili**  
**4B generativo → resolution comment**  
**Assignee → nearest-neighbour con confidence bassa**

Solo dopo farei un **QLoRA di Apertus Mini 4B specificamente ottimizzato per decisioni a logit**, creando 1–3k esempi puliti con opzioni A/B/C randomizzate.

---

## Utente

Il nostro obiettivo è creare una soluzione che abbia in contesto il training di questi 20k ticket / 173 pattern che hai trovato, e riesca dati 20 ticket blind in input a classificare correttamente. Secondo te la soluzione che proponi è facilmente implementabile, reliable e veloce? Come possiamo ottimizzare i tempi di output? Se i ticket fossero 50 quanto peggiorerebbero i timings?

## Assistente

Sì: per **20–50 ticket blind** la soluzione è implementabile, abbastanza reliable e soprattutto molto più veloce di un approccio generativo “un ticket alla volta”.

Visto che i 20k esempi collassano in circa **173 pattern / 11 famiglie semantiche**, non serve tenere davvero 20.000 ticket interi nel prompt. Conviene trasformarli in una memoria compatta:

- indice BM25/TF-IDF o embedding sui 20k;
- per ogni ticket blind recuperare i **3–8 esempi più simili**;
- aggiungere una tabella compatta dei 173 pattern;
- lasciare al modello solo i campi non deterministici;
- risolvere i campi deterministici con mapping/regole.

Questo mantiene praticamente “in contesto” l’intero training set senza pagare il costo di inserirlo integralmente nel context window.

### Reliability

Per `Work type`, `Service Team` e probabilmente `Affected Service`, mi aspetterei affidabilità molto alta perché il dataset è fortemente strutturato e ripetitivo.

Per `Urgency / Impact / Priority`, la reliability dipende più dalle **regole del challenge** che dal training storico; userei quindi istruzioni esplicite e output vincolato.

`Assignee` e `Resolution` restano i punti deboli perché non sembrano avere un forte segnale predittivo nei 20k esempi. Il fine-tuning non risolverebbe magicamente questa parte.

### Implementazione

```text
startup
 ├─ load 20k JSON
 ├─ normalizza
 ├─ costruisci indice retrieval
 └─ carica mapping / pattern

20 blind tickets
        │
        ├── retrieval top-k
        ├── rules/mapping
        └── batch LLM classification
                    │
                    ↓
              JSON finale
```

Userei Python per l’orchestrazione e `llama.cpp`/Rizzo Flow come server locale. Il retriever è semplice da fare con `scikit-learn` TF-IDF; non partirei dagli embeddings finché TF-IDF non mostra un problema.

### Ottimizzare la velocità

La cosa più importante è **non fare 20 × N richieste indipendenti**. Il prompt del ticket va elaborato una sola volta, conservando la KV cache per più classificazioni sullo stesso stato. Ancora meglio: batching sui ticket.

```text
20 ticket
↓
retrieval di tutti e 20 in parallelo
↓
20 prompt costruiti
↓
batch inference
↓
4 decisioni/ticket tramite logits
```

Niente generation per i campi categoriali. Per le categorie userei token singoli (`A`–`T`) e leggerei direttamente i logits. È molto più veloce che generare i nomi completi token per token.

### Stima M4 24 GB

| Pipeline | 20 ticket | 50 ticket |
|---|---:|---:|
| retrieval | <1 s | <1 s |
| regole/mapping | trascurabile | trascurabile |
| classificazione 4B ottimizzata | ~10–30 s | ~25–70 s |
| eventuali resolution generate | +20–60 s | +50–150 s |
| **solo classificazione** | **~15–35 s** | **~30–80 s** |
| **pipeline con testo generativo** | **~40–90 s** | **~1,5–3,5 min** |

La crescita da 20 a 50 non dovrebbe essere catastrofica. In teoria è 2,5×, ma con batching e riuso di prefissi/cache alcune fasi crescono meno. Se 20 ticket richiedono 20 secondi, 50 potrebbero richiederne **35–45**.

### Ottimizzazione più aggressiva

Sfrutterei i **173 pattern** prima ancora dell'LLM:

```text
blind ticket
    ↓
similarità con 173 canonical patterns
    ↓
confidence > 0.95 ?
   /             \
 sì               no
 ↓                 ↓
usa mapping       LLM
```

È possibile che gran parte dei blind venga riconosciuta direttamente. L'LLM diventa un **fallback intelligente**, non il classifier principale.

Vantaggi:

- **velocità:** molti ticket potrebbero non richiedere inference completa;
- **reliability:** per pattern già visti si usa esattamente quanto appreso dal training;
- **spiegabilità:** “matched historical pattern X with similarity 0.97”.

Con soli 173 pattern, possiamo costruire un piccolo **prototype classifier** in cui ogni pattern è un prototipo e l'LLM viene interrogato soltanto quando i primi due candidati sono troppo vicini. Potenzialmente porta i 20 ticket blind a **pochi secondi più un numero molto ridotto di inference LLM**.
