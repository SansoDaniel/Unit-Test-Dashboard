# Report di import

File: `MyoLogic Pro - Unit Test v.2.1_rev00.xlsx` · generato il 26/10/2026

Prova a secco: questo report descrive cosa entrerà nel database. Niente viene scritto finché non si esegue l'import con `--apply`.

## Cosa verrà importato

| Elemento | Quantità |
|---|---|
| Unità del software | 29 |
| Casi d'uso | 148 |
| Test | 264 |
| Dispositivi | 7 (AH02, AK01, AH03, PRISM, MyoUnit, PULSE, Demo Unit) |
| Configurazioni e sessioni | 4 |
| Esiti | 1056: PASSED 335, NOT PASSED 12, NOT AVAILABLE 4, NOT TESTED 705 |
| Release (storico revisioni) | 32, da v1.0 a v.2.1_rev00 |
| Persone | 3 (Angelo Carrabba, Matteo Aventaggiato, Gianluca D'Amico) |

## Da confermare

### Unità unite (decisione 5)

| Nome nel file | Diventa | Test spostati |
|---|---|---|
| Gestione Account TO | Gestione account (TO) | 5 |
| Gestione Dispostiivi | Gestione Dispositivi | 11 |
| Gestione account Distributore | Gestione account (DIS) | 1 |

Se una di queste unioni non va bene, va tolta da `UNIT_MERGES` in `scripts/import-excel.js` prima dell'import.

### Report di esito e sessioni

- Il foglio Esito Test indica la versione software **v.2.0.1**, ma la release più recente dello storico è **v.2.1_rev00**. Report e sessioni vengono collegati a v.2.1_rev00.
- Il testo "Tutti i test sono PASSED" non viene importato: nel software il risultato si calcola dalle sessioni (12 NOT PASSED).
- L'esito finale del file è **PASSED**, diverso da quello calcolato, e non ha una motivazione: andrà scritta nel report. Il report entra come approvato.
- Autore e approvatori della copertina (firme del 04/08/2026) vengono collegati a v.2.1_rev00.
- Le 4 sessioni hanno tester Gianluca D'Amico, data 20/09/2026 e stato "chiusa".
- Questi nomi di foglio sono lunghi 31 caratteri, il massimo di Excel, e potrebbero essere troncati: "AH03 + rotatore + PRISM + Pulse", "AH03 + coaxial plug 6 bande + 2", "Conn.Remota ProiOS-AH02AH03+rot", "Conn.Remota ProAndroid-AH02AH03". Si rinominano nell'app.
- I dispositivi delle configurazioni non sono nel file: si indicano nell'app (fase 3).

### Persone

- "G. D'Amico" nello storico revisioni → Gianluca D'Amico
- "A. Carrabba" nello storico revisioni → Angelo Carrabba

## Correzioni automatiche

### ID assegnati (decisione 4): 99

| Riga | Nuovo ID | Motivo | Test |
|---|---|---|---|
| 46 | 168 | mancante | Associa Dati Training |
| 47 | 169 | mancante | Visualizza Dati Training |
| 84 | 170 | mancante | Verifica che il dispositivo aggiunto sia stato aggiunto anche nel profilo MyoLogic |
| 85 | 171 | mancante | Eliminare un dispositivo AH dall'archivio dispositivo con account CPO |
| 86 | 172 | mancante | Eliminare un dispositivo AH dall'archivio dispositivo con account DIS |
| 92 | 173 | mancante | Visualizzare Specifiche Dispositivo |
| 97 | 174 | mancante | Lettura segnali EMG |
| 100 | 175 | mancante | Abilitare/Disabilitare Elettrodi |
| 101 | 176 | mancante | Rilevazione Elettrodi |
| 102 | 177 | mancante | Visulaizzazione della schermata EMG - Demo Unit modalità Analogica |
| 103 | 178 | mancante | Visulaizzazione della schermata EMG - Modalità Standby attiva |
| 104 | 179 | mancante | Attivazione e Disattivazione dei motori nella schermata EMG |
| 105 | 180 | mancante | Segnalazione Gain Digitiale a zero |
| 106 | 181 | mancante | Registrazione dei segnali EMG |
| 107 | 182 | mancante | Salvataggio dei segnali EMG |
| 108 | 183 | mancante | Salvataggio dei segnali EMG |
| 109 | 184 | mancante | Verifica salvataggio segnali EMG |
| 111 | 185 | mancante | Calibra Adam’s Hand - Dual Site con PRISM |
| 113 | 186 | mancante | Calibra Adam’s Hand Dual Site - Procedura Annullata da pulsante |
| 115 | 187 | mancante | Calibrazione con Polso installato su PRISM (estensione di Calibra Adam’s Hand - Dual Site con PRISM) |
| 117 | 188 | mancante | Verifica della Modalità di Commutazione del Polso - Standard Control |
| 118 | 189 | mancante | Verifica della Modalità di Commutazione del Polso (se installato) - Double Spike |
| 119 | 190 | mancante | Verifica della Modalità di Commutazione del Polso(se installato) - Co-Contraction |
| 120 | 191 | mancante | Verifica della Modalità di Commutazione del Polso (se installato) - 4 - Channel |
| 121 | 192 | mancante | Calibra Adam’s Hand - Single Site |
| 122 | 193 | mancante | Calibra Adam’s Hand - Single Site con PRISM |
| 123 | 194 | mancante | Calibra Adam’s Hand in Single Site - Procedura Annullata |
| 124 | 195 | mancante | Calibra Adam’s Hand Single Site - Procedura Annullata da pulsante |
| 125 | 196 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - 2-Channel |
| 126 | 197 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - Alternate |
| 127 | 198 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - Voluntary Open |
| 128 | 199 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - Voluntary Close |
| 129 | 200 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - 2 Channel + Wrist (se wrist installato) |
| 130 | 201 | mancante | Verificare attivazione LONG-OPEN |
| 131 | 202 | mancante | Calibra Adam’s Hand - PRISM |
| 132 | 203 | mancante | Calibra Adam’s Hand PRISM - Procedura Annullata |
| 133 | 204 | mancante | Calibra Adam’s Hand PRISM - Procedura Annullata da pulsante |
| 134 | 205 | mancante | Calibrazione SINGOLA POSA |
| 135 | 206 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - STANDARD CONTROL |
| 136 | 207 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - STANDARD CONTROL solo MANO |
| 137 | 208 | mancante | Selezione e verifica del Metodo di controllo di Adam's Hand - CO-CONTRACTION |
| 138 | 209 | mancante | Selezione del ritardo di attivazione dei comandi automatici di apertura e chiusura per le strategie di controllo Volutary Open e Voluntary Close |
| 142 | 210 | mancante | Abilitare / Disabilitare Direct Pose Transition |
| 143 | 211 | mancante | Abilitare / Disabilitare Direct Pose Transition |
| 149 | 212 | ID 103 già usato | Modifica dei valori di Sensitività per ogni slot di calibrazione |
| 153 | 213 | mancante | Visualizzazione della schermata Calibration - Demo Unit modalità Analogica |
| 154 | 214 | mancante | Visualizzazione della schermata Calibration - Modalità Standby attiva |
| 155 | 215 | mancante | Visualizzazione della schermata Calibration - Presa in corso |
| 156 | 216 | mancante | Visualizzazione della schermata Calibration con sistema di controllo di terze parti selezionato |
| 159 | 217 | mancante | Visualizza Info Dispositivo - PRISM |
| 160 | 218 | mancante | Attivare Direzione Rotazione Polso |
| 161 | 219 | mancante | Visualizza Info Dispositivo - PULSE |
| 162 | 220 | mancante | Visualizza Info Dispositivo - Demo unit |
| 163 | 221 | mancante | Attivare Direzione Rotazione Polso |
| 168 | 222 | mancante | Aggiornamento Adam's Hand con versione "Standard" |
| 172 | 223 | mancante | Aggiornamento Firmware PRISM |
| 177 | 224 | mancante | Aggiornamento PRISM fallito |
| 182 | 225 | mancante | Recovery Mode PRISM |
| 187 | 226 | mancante | Aggiornamento Forzato PRISM |
| 191 | 227 | mancante | Aziona Thumb Automaticamente - Adam's Hand |
| 192 | 228 | mancante | Aziona Thumb Manualmente - Adam's Hand |
| 193 | 229 | mancante | Aziona Wrist Automaticamente - PRISM |
| 194 | 230 | mancante | Aziona Wrist Manualmente - Adam's Hand |
| 200 | 231 | mancante | Abilitare/disabilitare la modalità Modalità Sostituzione Guanto su Adam’s Hand |
| 203 | 232 | mancante | Procedura Grip-Tuning |
| 205 | 233 | mancante | Fine Tuning - Regolazione Fine Tuning |
| 218 | 234 | ID 152 già usato | Visualizza informazioni PRISM |
| 224 | 235 | mancante | Visualizza i manuali d'uso dei prodotti a dispositivo connesso |
| 235 | 236 | mancante | Regolazione Battery Power |
| 236 | 237 | mancante | Regolazione Impostazione pollice |
| 237 | 238 | mancante | Configurazione dispositivo tramite connessione remota |
| 238 | 239 | ID 167 già usato | Calibrazione, segnali EMG e test tramite connessione remota |
| 239 | 240 | mancante | Permette di effettuare una connessione remota ad un Adam's Hand: connessione accettata dall'utente |
| 240 | 241 | mancante | Permette di effettuare una connessione remota ad un Adam's Hand: connessione rifiutata dall'utente |
| 241 | 242 | mancante | Permette di terminare la connessione remota ad Adam's Hand |
| 242 | 243 | mancante | Gestione della connessione a seguito terminazione da parte dell'utente |
| 243 | 244 | mancante | Configurazione dispositivo tramite connessione remota |
| 244 | 245 | ID 167 già usato | Calibrazione, segnali EMG e test tramite connessione remota |
| 245 | 246 | mancante | Permette di effettuare una connessione remota ad un Adam's Hand: connessione accettata dall'utente |
| 246 | 247 | mancante | Permette di effettuare una connessione remota ad un Adam's Hand: connessione rifiutata dall'utente |
| 247 | 248 | mancante | Permette di terminare la connessione remota ad Adam's Hand |
| 248 | 249 | mancante | Gestione della connessione a seguito terminazione da parte dell'utente |
| 249 | 250 | mancante | Download dei Datalog (Logs + Eventi) post connessione ad Adam's Hand |
| 250 | 251 | mancante | Interruzione dei Datalog da parte del FW quando AH è impegnata su task propritari |
| 251 | 252 | mancante | Ritentativo di Download dei Datalog dopo 5 minuti dal tentativo precedente |
| 252 | 253 | mancante | Visualizzazione della schermata Usage Data Dashboard con lo storico logs del dispositivo, accedendo alla relativa sezione a dispositivo connesso |
| 253 | 254 | mancante | Visualizzazione della schermata Usage Data Dashboard con lo storico logs del dispositivo, accedendo alla relativa sezione a dispositivo disconnesso |
| 254 | 255 | mancante | Visulizzazione Alert per connettività BLE assente |
| 255 | 256 | mancante | Visulizzazione Alert per connettività WI-FI assente |
| 256 | 257 | mancante | Visulizzazione Alert per PERMESSI di acceso a Camera e BLE |
| 257 | 258 | mancante | Visualizzazione Alert Consenso Privacy Policy |
| 258 | 259 | mancante | Accetta Consenso Privacy Policy |
| 259 | 260 | mancante | Rifiuta Consenso Privacy Policy |
| 260 | 261 | mancante | Visualizzazione Consenso nella procedura di registrazione |
| 261 | 262 | mancante | Accetta Consenso Privacy Policy |
| 262 | 263 | mancante | Rifiuta Consenso Privacy Policy |
| 263 | 264 | mancante | Accensione/Spegnimento dei 4 motori vibratori |
| 264 | 265 | mancante | Associazione degli eventi ai pattern di vibrazione |
| 265 | 266 | mancante | Test degli eventi associati con diversi pattern di vibrazione |

### Esiti riscritti: 4

| Foglio | Riga | ID | Nel file | Diventa |
|---|---|---|---|---|
| Conn.Remota ProiOS-AH02AH03+rot | 156 | 216 | `"NOT AVAILABLE "` | NOT AVAILABLE |
| Conn.Remota ProiOS-AH02AH03+rot | 230 | 163 | `"NOT PASSED (lato grafico)"` | NOT PASSED + "Problema grafico" |
| Conn.Remota ProAndroid-AH02AH03 | 111 | 185 | `"NOT PASSED (lato grafico)"` | NOT PASSED + "Problema grafico" |
| Conn.Remota ProAndroid-AH02AH03 | 156 | 216 | `"NOT AVAILABLE "` | NOT AVAILABLE |

### Esiti vuoti, importati come NOT TESTED: 19

- AH03 + rotatore + PRISM + Pulse: 3 (ID 109, 160, 161)
- AH03 + coaxial plug 6 bande + 2: 7 (ID 193, 157, 235, 158, 159, 160, 161)
- Conn.Remota ProAndroid-AH02AH03: 9 (ID 89, 192, 200, 138, 232, 139, 141, 147, 148)

### Dispositivi

- 20 celle con spazi intorno ai nomi dei dispositivi, ripulite (es. " PRISM" → "PRISM").
- 28 test senza dispositivo indicato: ID 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 27, 28, 29, 30, 31, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 237.

### Test senza nome: 3

- Riga 263, ID 264: usato il nome del caso d'uso, "Accensione/Spegnimento dei 4 motori vibratori".
- Riga 264, ID 265: usato il nome del caso d'uso, "Associazione degli eventi ai pattern di vibrazione".
- Riga 265, ID 266: usato il nome del caso d'uso, "Test degli eventi associati con diversi pattern di vibrazione".
