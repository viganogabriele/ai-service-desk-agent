# Rizzo Flow e compatibilità con Apertus

> **Archived technical discussion — not a current compatibility guarantee.** The 2026-09-24 advisor review does not verify the model versions, architecture claims or runtime support below. Check primary model/runtime documentation before selecting an alternative. See [ANALYSIS.md](../ANALYSIS.md) and [ADVISOR_REVIEW.md](../ADVISOR_REVIEW.md) for the current measured baseline and experiment plan. Original conversation preserved below.

## User

guarda [https://github.com/Rizzo-AI-Academy/rizzo-flow](https://github.com/Rizzo-AI-Academy/rizzo-flow) dimmi come funziona ad alto livello e se posso applicarlo anche ad altri modelli come apertus 1.5 o 1.1 mini

## Assistant

Sì. Il concetto di **Rizzo Flow è molto più generale del modello Spark che usa di default**; il vero limite è il backend/runtime con cui il repository è implementato.

### Come funziona ad alto livello

Rizzo Flow trasforma una domanda in una specie di **multiple choice**:

```text
Ticket:
"I can't login to Salesforce"

Choose the correct team:
A. Finance
B. IT Support
C. HR
D. Sales Ops

Answer:
```

Invece di far generare al modello `"B"` e poi parsarlo:

```text
LLM → B → stop
```

fa soltanto il forward pass e guarda direttamente:

```text
logit(A) = 1.2
logit(B) = 8.7
logit(C) = -2.1
logit(D) = 4.0

softmax →
A 0.05%
B 99.0%
C 0.00%
D 0.95%
```

Quindi:

**testo → transformer → logits → softmax → decisione**

Zero token generati. citeturn158365search2

La parte particolarmente interessante è che, se devi fare più decisioni sullo stesso input, Rizzo fa:

```text
                ┌─ domanda 1 → logits
ticket → KV ────┼─ domanda 2 → logits
cache           ├─ domanda 3 → logits
                └─ domanda N → logits
```

Il ticket viene processato **una volta sola**, poi il KV cache viene riutilizzato. Le domande vengono inoltre micro-batchate. citeturn158365search2

È proprio questo che lo rende interessante per il vostro problema dei ticket.

---

## Puoi usarlo con Apertus?

### Apertus v1.1 Mini: **concettualmente sì, e abbastanza facilmente**

La famiglia Mini comprende:

- 0.5B
- 1.5B
- 4B

anche in versione Instruct. citeturn475268search5

La loro architettura è un decoder transformer autoregressivo, quindi produce esattamente i logits che servono a Rizzo Flow. Per esempio Apertus v1.1 1.5B usa GQA + xIELU. citeturn279118search1

Inoltre `llama.cpp`, che è il backend dell'attuale Rizzo Flow, ha già supporto per l'architettura classica Apertus: il supporto è stato mergiato il **2 ottobre 2025** e oggi esiste esplicitamente `ApertusForCausalLM` / `MODEL_ARCH.APERTUS`. citeturn317436view0turn317436search0

Quindi per **Apertus v1.1 Mini** la strada realistica è:

```text
Apertus v1.1 Instruct
       ↓
conversione GGUF
       ↓
Rizzo Flow --model aperture.gguf
       ↓
adattamento prompt/tokenizer
       ↓
benchmark
```

Non mi aspetterei che funzioni perfettamente semplicemente cambiando filename: Rizzo verifica, per esempio, che `A/B/C/...` siano token singoli e il prompt attuale è stato ottimizzato appositamente su Spark. citeturn158365search2

Ma sono modifiche relativamente piccole.

---

## Apertus v1.5: situazione diversa

Apertus **1.5** attuale è disponibile in **8B e 70B** ed è anche multimodale, con context fino a 262k. citeturn475268search2turn475268search12

Qui al momento c'è un ostacolo concreto: **llama.cpp non ha ancora supporto completo ad Apertus v1.5**. La feature request aperta il 30 luglio 2026 è ancora aperta, e ci sono modifiche architetturali necessarie, tra cui la gestione separata delle dimensioni del vocabulary dell'output. citeturn475268search8turn475268search7

Quindi oggi:

| Modello | Idea Rizzo | Rizzo attuale |
|---|---:|---:|
| Spark 4B | ✅ | ✅ nativo |
| Apertus v1.1 0.5B | ✅ | 🟢 probabilmente adattabile |
| Apertus v1.1 1.5B | ✅ | 🟢 probabilmente adattabile |
| Apertus v1.1 4B | ✅ | 🟢 probabilmente adattabile |
| Apertus v1.5 8B | ✅ | 🟠 backend da modificare |
| Apertus v1.5 70B | ✅ | 🟠 backend da modificare |

---

### In realtà non sei obbligato a usare Rizzo Flow

Per il **vostro hackathon**, io probabilmente prenderei **l'idea di Rizzo**, non necessariamente tutto Rizzo.

Con HuggingFace:

```python
outputs = model(**inputs)

last_logits = outputs.logits[0, -1]

scores = last_logits[
    [token_A, token_B, token_C, token_D]
]

probs = scores.softmax(dim=-1)
```

Ed hai sostanzialmente il cuore di Rizzo Flow.

Con Apertus v1.5 questo può essere fatto direttamente tramite Transformers, perché il modello è ufficialmente supportato lì. citeturn475268search0

Per il vostro caso dei **20k ticket / 173 pattern**, questa cosa diventa particolarmente interessante: invece di chiedere al modello di generare JSON con `Service Team`, `Assignee`, `Resolution`, ecc., possiamo costruire una pipeline dove **ciascun campo è una classificazione sui logits**.

Secondo me vale parecchio la pena: posso anche mostrarti **come applicherei esattamente l'approccio Rizzo Flow al dataset SwissLife dei 20k ticket che stavamo analizzando**, inclusa la questione critica dei **173 pattern** e di come evitare di dover mettere 173 opzioni in un'unica classificazione.
