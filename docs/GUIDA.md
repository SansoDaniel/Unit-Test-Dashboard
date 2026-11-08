# Guida rapida a MyoLogic Test Manager

Per chi esegue gli Unit Test di MyoLogic Pro e per chi li approva. Serve un account: lo crea il responsabile del software.

## Prima volta

1. Accedi con email e password.
2. In *Impostazioni → Persone* scegli il tuo account accanto al tuo nome. Da quel momento gli esiti che registri portano il tuo nome e ricevi le notifiche delle release di cui sei autore o approvatore.

## Scegliere la release

In alto a destra c'è la release in uso, per esempio **Release v.2.1_rev00**. Catalogo, sessioni e dashboard mostrano i suoi esiti. Per cambiarla: clicca il nome, poi **Usa questa** accanto alla release che ti serve.

## Eseguire una sessione

1. Apri **Sessioni** e scegli la configurazione su cui lavori, per esempio "AH03 + rotatore + PRISM + Pulse". Se non c'è: **Nuova sessione**, scegli release e configurazione, **Crea sessione**.
2. Per ogni test scegli l'esito con i pulsanti **PASSED**, **NOT PASSED**, **NOT TESTED** o **N/A**. Si salva subito.
3. Più veloce, da tastiera:

   | Tasto | Azione |
   |---|---|
   | ↓ ↑ | passa al test successivo o precedente |
   | P, F, N, A | PASSED, NOT PASSED, NOT TESTED, NOT AVAILABLE, poi passa al test successivo |
   | Invio | apre descrizione, operazioni e nota del test |

4. Per una nota clicca il nome del test (o Invio), scrivi nel campo **Nota** ed esci dal campo: si salva da sola. Spunta **Problema grafico** se il difetto riguarda solo la grafica.
5. Le schede in alto filtrano i test: **Da eseguire e falliti** mostra quel che resta da fare.
6. A fine lavoro, **Chiudi sessione**: diventa di sola lettura e autore e approvatori ricevono una notifica. Si può riaprire.

La barra in fondo alla sessione dice sempre l'ultimo salvataggio. Se compare **"Test … non salvato"** in rosso, l'esito di quel test non è registrato: controlla la connessione e premi di nuovo il tasto.

Serve un test che manca nella sessione? **Aggiungi test**. Un test ancora NOT TESTED e senza nota si può togliere dai suoi dettagli con **Togli dalla sessione**.

## Notifiche

La campanella in alto conta le notifiche da leggere: nuovi NOT PASSED, sessioni chiuse, report da approvare. Clicca una notifica per aprire il test, la sessione o il report.

## Report di rilascio (responsabili)

1. **Release → Report di esito**. Versione, conteggi ed esito calcolato arrivano dalle sessioni.
2. Compila data, persona, motivazione, prossime azioni e **Risultato finale**. Se è diverso dall'esito calcolato, scrivi la motivazione: senza, il report non parte.
3. **Invia agli approvatori**. Un approvatore della release apre il report e preme **Approva report**. Se il report viene modificato dopo, torna in bozza e va reinviato.
4. **Esporta Excel** scarica il documento nel formato abituale; **Esporta PDF** apre la versione da stampare o salvare in PDF.

## Catalogo

In **Catalogo** si cercano e si modificano i test: la modifica vale per tutte le sessioni. **Elimina test** archivia un test che ha già esiti (resta nei report passati) ed elimina definitivamente solo quelli mai eseguiti. Ogni modifica finisce nello storico della scheda del test, con nome e data.

## Se qualcosa non torna

- **Non vedo gli esiti che mi aspetto**: controlla la release in uso in alto a destra.
- **"La sessione è chiusa"**: riaprila con **Riapri sessione**, se sei autorizzato a farlo.
- **"Errore del server"**: riprova; se continua, avvisa il responsabile del software indicando la pagina e l'ora.
