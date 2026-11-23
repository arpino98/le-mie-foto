# Le mie foto – app per Android e iPhone

È la stessa cosa che usavi sul computer, ma sul telefono e direttamente sulla galleria: niente cartelle da copiare, niente formato HEIC da convertire.

## Cosa fa

**Foto simili**
- Scegli il periodo (ultimi 30 giorni, 3 mesi, un anno o tutte) e premi *Scegli foto*.
- Le foto simili vengono raggruppate: la più nitida è in verde (TIENI), le altre in rosso (SCARTA). Tocchi una foto per cambiarla, con 🔍 la vedi grande.
- *Sposta scartate nel cestino* le mette nel cestino del telefono (su iPhone in *Eliminati di recente*). Restano lì circa 30 giorni, quindi puoi recuperarle.

**Persone e animali**
- Trova i volti e li raggruppa per persona, e trova le foto con gatti e cani.
- Scrivi un nome sotto ogni gruppo. Tocchi un volto sbagliato per escluderlo, lo tieni premuto per vedere la foto.
- *Crea album* crea un album per ogni nome.
  - Su iPhone le foto vengono aggiunte agli album, senza duplicarle.
  - Su Android le foto vengono copiate in *Immagini/Classificate/Nome*, e le trovi come album nella Galleria o in Google Foto.
- *Ricorda persone* memorizza i nomi sul telefono, così la volta dopo le riconosce da sola.

**Cosa occupa più spazio**
- Divide foto e video in categorie, ciascuna con numero e peso: video (dal più pesante), screenshot, WhatsApp e altre app, sfocate, buie, doppioni identici.
- Apri una categoria, selezioni e sposti nel cestino.

**In più**
- L'analisi viene salvata sul telefono: se chiudi l'app, la volta dopo riparte da dove eri rimasta. Restano salvate anche le scelte (foto da tenere, nomi, volti esclusi). Puoi eliminarla con *Elimina analisi salvata*, oppure scegliere di non salvare i dati dei volti.
- Dopo che hai dato un nome, l'app propone i gruppi che potrebbero essere la stessa persona ("È Vincenzo?"). Rispondi Sì o No, e i No non vengono riproposti. Ogni persona ricordata ha più "volti tipo", così viene riconosciuta meglio anche quando cambia negli anni.
- Su iPhone le Live Photo hanno il badge LIVE con il peso del video, e il video va nel cestino insieme alla foto.
- Su Android, dopo aver spostato foto nel cestino, puoi rimetterle al loro posto con un tocco.

Tutto resta sul telefono. Niente viene caricato su internet, nemmeno i modelli di riconoscimento.

## Versione per computer

Nella cartella `computer/` c'è **Le_mie_foto.html**: la stessa cosa, ma per le foto copiate sul PC.

1. Scarica il file (apri `computer/Le_mie_foto.html` qui su GitHub e premi il pulsante *Download raw file*).
2. Aprilo con **Chrome** o **Edge** (doppio clic, o trascinalo nella finestra del browser), su Windows o su Mac. Funziona senza internet.
3. Premi *Scegli cartella foto* e scegli la cartella in cui hai copiato le foto dall'iPhone, anche in HEIC.

**Su Mac (iMac, MacBook)**
- Usa **Google Chrome** o **Microsoft Edge**, gratuiti. Con Safari puoi solo guardare i gruppi di foto simili, perché Safari non permette alla pagina di spostare o copiare file.
- Per aprirla: clic destro sul file → *Apri con* → *Google Chrome*.
- Per avere le foto in una cartella: collega l'iPhone e usa l'app *Acquisizione Immagine*, oppure in *Foto* seleziona le foto → *File* → *Esporta* → *Esporta originale non modificato* (così arrivano anche i video delle Live Photo).
- Non scegliere la libreria dell'app Foto: la pagina se ne accorge e non la tocca, perché modificarla la rovinerebbe.

Ha tre schede: *Foto simili*, *Classifica per persone e animali* e *Cosa occupa spazio*. Le foto scartate vanno nella sottocartella `_da_cancellare` (niente viene eliminato), ogni operazione si può annullare ed è scritta in `_registro_operazioni.csv`. L'analisi viene salvata nella cartella, così la volta dopo riparte da dove eri rimasta.

Il file contiene il decodificatore HEIC libheif (licenza LGPL 3.0, incluso senza modifiche) e il modello MobileNet per gli animali (licenza Apache 2.0).

## Installarla su Android (gratis)

1. Dalla pagina **Releases** del progetto su GitHub scarica dal telefono il file **LeMieFoto.apk**.
2. Aprilo. Se il telefono lo chiede, consenti l'installazione di app da questa fonte (Chrome o File). Su alcuni telefoni Play Protect avvisa che l'app è sconosciuta: scegli *Installa comunque*.
3. Al primo avvio l'app chiede il permesso di vedere le foto: scegli *Consenti tutte*.

Serve Android 11 o più recente.

## Installarla su iPhone

Apple non permette di installare app scaricate da internet come su Android. Le strade sono due:

- **Gratis, con un Mac**: installi Xcode dall'App Store del Mac, colleghi l'iPhone con il cavo, apri il progetto e premi ▶. Con un Apple ID gratuito l'app funziona per 7 giorni, poi va reinstallata nello stesso modo.
- **A pagamento (99 € l'anno)**: con un account Apple Developer l'app si distribuisce con TestFlight (link da aprire sull'iPhone) o sull'App Store, e non scade.

Passi con il Mac (servono Node.js e Xcode):

```
npm install
npx cap sync ios
npx cap open ios
```

In Xcode: seleziona *App* → *Signing & Capabilities* → scegli il tuo Apple ID come *Team*, collega l'iPhone, premi ▶. Sull'iPhone attiva *Impostazioni → Privacy e sicurezza → Modalità sviluppatore* e autorizza lo sviluppatore in *Impostazioni → Generali → VPN e gestione dispositivi*.

## Per chi sviluppa

- `www/` contiene l'interfaccia (HTML/JS) e i modelli di riconoscimento (`www/models`, libreria Human).
- `plugins/galleria/` è il collegamento nativo alla galleria (Java per Android, Swift per iPhone): elenco foto, miniature, cestino, album.
- Dopo una modifica in `www/` esegui `npx cap sync`.
- Ad ogni modifica su GitHub, l'APK Android viene compilato da solo (scheda *Actions*) e pubblicato in *Releases*. Un secondo controllo verifica che anche la versione iPhone si compili.
- Per provarla sul computer basta aprire `www/index.html` con un piccolo server locale. Nel browser le foto si scelgono a mano, mentre cestino e album funzionano solo sul telefono.
