> **Historical inspection notes — superseded 2026-09-24.** See [ANALYSIS.md](ANALYSIS.md) and [ADVISOR_REVIEW.md](ADVISOR_REVIEW.md) for current conclusions. Proposed sample corrections are not verified reference answers; “two errors / no false positives” was not an independent evaluation. A blank Business Critical for Entity field does not make it a required challenge output. Original notes follow for traceability.

Sì, ci sono diverse cose importanti da sapere.

Ho salvato il file come `sample_blind_eval_20.json` solo come **format sample** e **test fixture**. Né il tool né le note dipendono da questi specifici ticket.

## Il formato è diverso dal training dataset

### Envelope invece di array

I record non sono direttamente in un array: si trovano dentro:

```text
records
```

insieme ad altri metadata.

Il loader della dashboard prima avrebbe interpretato `requestedColumns` come dataset.

Ora è stato corretto e dà priorità a `records`.

### Ci sono 5 nuove colonne

- `Request type`
- `Business Critical for Entity`
- `Severity`
- `Linked issues`
- `Due date`

### Alcuni campi sono sempre vuoti

Questi sono quindi campi che dobbiamo produrre noi:

- Service Team(s)
- Assignee
- Resolution
- Business Critical for Entity

`Status` invece è sempre:

```text
open
```

### I livelli sono capitalizzati

Per esempio:

```text
Low
Highest
```

mentre nel training dataset erano lowercase.

Conviene quindi fare sempre una normalizzazione.

---

## Il nuovo campo più importante è `Request type`

`Request type` contiene 9 possibili valori che corrispondono, sostanzialmente, agli 11 template del training dataset.

Esempi:

- New License
- Access to a Service
- Access Removal
- Machine Created Alert
- Human Created Incident
- Email / 3rd Party Warning
- Nonsense / Unclear Input
- Misclassified Incident Title
- Misclassified Service Request Title

Questo campo dice già **che tipo di scenario stiamo gestendo**, prima ancora di leggere il testo.

Per esempio:

```text
Misclassified Incident Title
```

significa che il ticket sembra un Incident dal titolo, ma il vero Work Type dovrebbe essere **Service Request**.

Nei due casi misclassified presenti nel sample, la trap era esattamente quella indicata da `Request type`.

Quindi questo campo è un segnale molto forte.

---

## Priority ora è già coerente

Nei 20 ticket del sample:

```text
Priority = matrice(Urgency, Impact)
```

in tutti i casi.

Quindi, rispetto al training dataset, la trap è cambiata.

Il problema non è più la Priority incoerente, ma il fatto che **Urgency e Impact possono essere sbagliati rispetto al contenuto**.

Esempi:

- una normale access request con `High / High / High`;
- un ticket quasi incomprensibile come `"pls fix asap"` con `Highest / Highest`.

Quindi ci sono due strategie possibili:

1. Lasciare Urgency e Impact invariati.
   - La Priority rimane automaticamente consistente.

2. Correggere Urgency e Impact in base al contenuto.
   - In questo caso bisogna **ricalcolare anche Priority**.

---

## Le Service label sbagliate sono plausibili

Nel sample non viene usato il generic bucket:

```text
Emailed Support Tickets
```

I Service sbagliati sembrano invece plausibili.

Due esempi:

- un problema di benchmark publication delay assegnato a `SharePoint & File Storage`;
- un LEI regulator-gateway rejection assegnato a `CRM & Client Portal`.

Questi errori possono essere scoperti solo classificando correttamente il contenuto.

Dopo aver migliorato le service keywords, la dashboard identifica esattamente questi 2 ticket e non genera falsi positivi sugli altri 18.

---

## Le frasi "questa label potrebbe essere sbagliata" sono rumore

Sei description contengono frasi del tipo:

> il Service selezionato potrebbe non essere corretto

oppure:

> questa classificazione è solo un'ipotesi

Ma in **4 casi su 6 il Service è in realtà corretto**.

Quindi il modello non deve interpretare queste frasi come prova che la label sia sbagliata.

Il contenuto reale del ticket deve pesare di più.

---

## Molti scenari derivano dalle 21 resolution narrative del training

11 dei 20 ticket descrivono problemi che corrispondono direttamente a resolution narrative già presenti nel training corpus.

Esempi:

- adapter che rifiuta allocations;
- fee section vuota;
- classification segment mancante in una submission;
- problema `SCD_POS_SYNC`;
- option code mancante;
- orders bloccati dopo un broker switch;
- settlement queue backlog;
- custodian status messages in ritardo;
- margin sweep cash;
- shared mailbox;
- withholding tax license.

Quindi il retrieval sulle **21 resolution narrative**, organizzato per Service, può essere molto utile per generare la Resolution.

Gli altri 9 ticket sono invece soprattutto:

- access requests;
- Service senza narrative disponibili, come:
  - Rimes;
  - NAV;
  - compliance dashboard.

In questi casi bisogna affidarsi maggiormente alla **domain knowledge dell'LLM**.

---

## Altri segnali utili

### `Linked issues`

Le key possono suggerire il possibile owner.

Esempi:

```text
IAM-
SCD-
RCM-
REP-
OPS-
```

Per esempio:

un ticket SharePoint per una access removal collegato a una issue `IAM-*` potrebbe in realtà appartenere a:

```text
Identity & Access Management
```

### Nuovi system commenters

Compaiono anche:

```text
service.desk@
monitoring.bot@
```

con commenti del tipo:

```text
Functional owner still unknown
```

Le reporter class continuano comunque a essere utili:

- `sa_*` → machine alerts;
- `info@extcom_*` → vendor / external warnings.

### Assignee rimane praticamente impossibile da imparare

Tre reporter del sample:

- helen.smith
- sebastian.eaton
- cora.russell

compaiono spesso nei comments del training, ma mai come assignee.

Quindi non emerge nessun nuovo segnale utile per prevedere Assignee.

### Nessuna prompt injection nel sample

Non ci sono prompt injection vere.

Ci sono soltanto frasi con pressione o urgenza.

Conviene comunque mantenere tutte le injection defences, perché il file finale viene rigenerato e potrebbe contenerne.

---

## Modifiche fatte nella folder

### `dashboard.html`

Ora:

- supporta correttamente l'envelope con `records`;
- mostra e filtra `Request type`;
- mostra `Linked issues` nel detail panel;
- aggiunge due nuovi flag:
  - Work Type incoerente con Request type;
  - intake che mette in dubbio la propria Service label;
- contiene service keywords migliorate;
- carica automaticamente `sample_blind_eval_20.json` quando viene servita via HTTP.

### `ANALYSIS.md`

È stata aggiunta una nuova **section 6** con tutti i punti descritti sopra.

### `screenshot_sample_eval.png`

Contiene uno screenshot della dashboard con il sample selezionato.
