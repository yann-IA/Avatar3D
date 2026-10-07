# Compagnon IA — avatar 3D vocal

Tu parles à voix haute à une IA et son avatar 3D te répond. 
Il **articule** pendant qu'il parle, **cligne des yeux**, **te regarde**, **respire**,
fait des **gestes** et change d'**expression** selon l'émotion de chaque phrase (joie, tristesse, surprise…).

Elle fonctionne dans un navigateur : **téléphone** (installable comme une application), **PC**,
**Raspberry Pi / mini-PC**. Aucun serveur à toi n'est nécessaire, et les clés API restent dans ton navigateur.

| Fonction | Ce qui est inclus |
|---|---|
| Avatar 3D | Modèles **VRM** (0.x et 1.0) : celui fourni, n'importe quel `.vrm` importé, ou une URL |
| Animation | Clignements, regard qui suit la caméra ou le pointeur, respiration, balancement, gestes en parlant, tête penchée quand il écoute, regard en l'air quand il réfléchit |
| Lèvres | Synchronisées sur le **son réel** (analyse du spectre → voyelles a/i/u/e/o) ou, avec les voix du navigateur, sur le **texte** |
| Émotions | L'IA annote chaque phrase (`[happy]`, `[sad]`, `[surprised]`…), le visage et la posture suivent |
| Gestes | Animations **VRMA** : salut de la main et danse fournis, import de tes propres `.vrma`. L'IA les déclenche d'elle-même (`[wave]`, `[dance]`) ou tu les lances avec le bouton ✋ |
| IA | OpenAI, **Claude**, Groq, Mistral, OpenRouter, DeepSeek, Gemini, **Ollama**, LM Studio, ou toute API compatible OpenAI |
| Voix | Voix de l'appareil (gratuites, réglage hauteur/vitesse), **OpenAI TTS** (avec consignes de ton), **ElevenLabs**, serveurs locaux (Kokoro…) |
| Écoute | Reconnaissance du navigateur (gratuite) ou **Whisper** (OpenAI, Groq, serveur local) avec détection automatique de fin de phrase |
| Conversation | Réponses en flux (l'avatar commence à parler dès la première phrase), interruption à tout moment, mode mains libres, mémoire réglable |

## Utiliser l'application en ligne (rien à installer)

👉 **https://yann-ia.github.io/Avatar3D/**

Ouvre ce lien dans **Chrome** ou **Edge**, sur PC ou sur téléphone. Sur téléphone, « Ajouter à l'écran
d'accueil » l'installe comme une application. Tes réglages et tes clés API restent enregistrés dans ton navigateur :
ils ne passent jamais par GitHub.

Le site est mis à jour automatiquement à chaque modification de la branche `main`
(`.github/workflows/deploy.yml`).

## Installation facile sous Windows (sans taper de commande)

1. **Installe Node.js** : sur [nodejs.org](https://nodejs.org), télécharge la version **LTS**, ouvre le fichier
   `.msi` et clique sur « Suivant » jusqu'au bout. Redémarre ensuite le PC.
2. **Télécharge l'application** : sur cette page GitHub, bouton vert **Code** → **Download ZIP**, puis clic droit
   sur le fichier → **Extraire tout…** (par exemple dans `Documents`).
3. **Double-clique sur `Demarrer.bat`** dans le dossier extrait.
   - Si Windows affiche « Windows a protégé votre ordinateur », clique sur **Informations complémentaires** puis
     **Exécuter quand même** : c'est normal pour un fichier téléchargé.
   - La première fois, l'installation des composants prend 1 à 3 minutes.
   - L'application s'ouvre ensuite dans Chrome (ou Edge). **Laisse la fenêtre noire ouverte** pendant
     l'utilisation ; ferme-la pour arrêter.
4. Les fois suivantes, il suffit de double-cliquer à nouveau sur `Demarrer.bat`.

Puis règle l'IA et la voix comme expliqué ci-dessous (étapes 1 à 3).

## Démarrage rapide (ligne de commande)

Il faut [Node.js](https://nodejs.org) 20.19 ou plus récent (22.12+ pour lancer les tests).

```bash
git clone https://github.com/yann-IA/Avatar3D.git
cd Avatar3D
npm install
npm run dev
```

Ouvre l'adresse affichée (http://localhost:5173). Ensuite :

1. **⚙ → IA** : choisis un fournisseur, colle ta clé API et choisis un modèle (le bouton « Lister » charge les
   modèles disponibles).
2. **⚙ → Voix** : choisis une voix et clique sur « Tester la voix ».
3. Appuie sur le **micro** (ou la barre d'espace), parle, et attends sa réponse. Tu peux aussi écrire.

> Pour essayer gratuitement : Groq a une offre gratuite (IA et Whisper), et Ollama fait tourner l'IA sur ta machine.

## Sur un téléphone

Le micro n'est autorisé qu'en **HTTPS** (ou sur `localhost`). Sur ton réseau local :

```bash
HTTPS=1 npm run dev
```

Ouvre `https://<adresse-IP-du-PC>:5173` sur le téléphone, accepte l'avertissement de certificat (il est
auto-signé), puis « Ajouter à l'écran d'accueil » pour l'installer comme une application.

Pour un usage permanent, publie le dossier `dist/` (créé par `npm run build`) sur un hébergeur HTTPS statique
(GitHub Pages, Netlify, Cloudflare Pages…). Comme tout se passe dans le navigateur, aucun serveur n'est nécessaire.

## Sur un Raspberry Pi ou un mini-PC

Un Raspberry Pi 4 ou 5 suffit : le rendu 3D se fait sur la puce graphique et l'IA tourne dans le cloud (ou sur
une autre machine avec Ollama).

```bash
npm install
npm run fetch-avatar        # copie locale de l'avatar (plus rapide, marche hors-ligne)
npm run build
npm run preview -- --port 8080 &
chromium-browser --kiosk --autoplay-policy=no-user-gesture-required http://localhost:8080
```

- **Écoute** : Chromium sur Linux n'a pas la reconnaissance vocale intégrée. Choisis **Whisper**
  (Groq : `https://api.groq.com/openai/v1`, modèle `whisper-large-v3-turbo`, très rapide).
- **Affichage → Qualité graphique : Basse** si l'animation est saccadée.
- Un micro USB (ou une enceinte avec micro intégré) fait l'affaire.

## Changer d'avatar

**⚙ → Avatar** : « Importer un fichier .vrm » (il est conservé dans le navigateur) ou colle une URL.

- [VRoid Studio](https://vroid.com/studio) : crée ton propre personnage, gratuitement, puis exporte-le en VRM.
- [VRoid Hub](https://hub.vroid.com) : des milliers de modèles, dont beaucoup sont téléchargeables.
- [Booth](https://booth.pm) : modèles gratuits et payants.

Vérifie la licence de chaque modèle. L'avatar fourni est le modèle d'exemple de pixiv
(`VRM1_Constraint_Twist_Sample`), dont la licence autorise la redistribution.

Les expressions utilisées sont celles du standard VRM (`happy`, `sad`, `angry`, `surprised`, `relaxed`,
`aa`/`ih`/`ou`/`ee`/`oh`, `blink`) : tout modèle VRM correct les possède.

## Gestes et animations (VRMA)

Le format **VRMA** (VRM Animation) décrit un mouvement qui s'applique à n'importe quel avatar VRM.
Deux animations sont fournies :

| Geste | Balise de l'IA | Comportement |
|---|---|---|
| Salut de la main | `[wave]` | Pour dire bonjour ou au revoir ; l'avatar continue de te regarder et de parler |
| Danse | `[dance]` | Quand tu le lui demandes ou pour fêter quelque chose ; la caméra recule pour montrer tout le corps |

- **Bouton ✋** (en haut) : lance un geste à la main. **Échap** arrête l'animation en cours.
- **⚙ → Gestes** : importe tes fichiers `.vrma`. Chacun reçoit une balise tirée de son nom (« Grand salut »
  devient `[grand-salut]`) et l'IA est prévenue qu'elle peut l'utiliser. Une case permet de désactiver les
  gestes spontanés de l'IA.
- Où trouver des VRMA : des packs gratuits (dont celui de VRoid) sur [Booth](https://booth.pm/en/search/VRMA),
  en vérifiant leur licence, ou crée les tiennes dans Blender avec l'extension VRM.

Les deux animations fournies sont générées par `scripts/build-vrma.mjs`. Chaque mouvement y est décrit par une
fonction du temps, ce qui permet de les retoucher facilement ou d'en ajouter. Relance ensuite
`npm run build-vrma` pour regénérer `public/animations/*.vrma`.

## Changer de voix et de ton

| Moteur | Coût | Ton de voix |
|---|---|---|
| Voix de l'appareil | Gratuit, hors-ligne | Choix de la voix, hauteur, vitesse. Sur PC, les voix « Google » (Chrome) ou « Natural » (Edge) sont les plus agréables |
| OpenAI `gpt-4o-mini-tts` | Payant, peu cher | 11 voix, et un champ **« ton / style »** en langage naturel : « joyeuse et énergique », « chuchotée », « timide »… |
| ElevenLabs | Offre gratuite limitée | Voix très naturelles, stabilité, expressivité, clonage de voix |
| Kokoro-FastAPI (local) | Gratuit | Choisis « OpenAI / compatible », adresse `http://localhost:8880/v1`, voix `ff_siwis` (française) |

## Choisir l'IA

Tout se règle dans **⚙ → IA**. Chaque fournisseur garde sa propre clé et son propre modèle, tu peux donc passer
de l'un à l'autre à tout moment. La personnalité se règle dans **⚙ → Personnage**.

- **Claude** : utilise le SDK officiel Anthropic. Le réglage « Rapidité » (effort) est sur « Rapide » par défaut,
  pour la voix. Pour encore moins d'attente, choisis `claude-haiku-4-5` ou `claude-sonnet-5-5`. Sur les modèles
  récents, si un filtre de sécurité refuse une requête, elle est automatiquement rejouée sur un autre modèle
  (paramètre `fallbacks: "default"`).
- **Ollama** : `ollama serve` puis `ollama pull llama3.2`. Si le navigateur bloque l'appel, lance Ollama avec
  `OLLAMA_ORIGINS=*` ou coche « Passer par le relais local ».
- **Erreur CORS / « Failed to fetch »** : certains fournisseurs refusent les appels faits directement depuis un
  navigateur. Coche **« Passer par le relais local »** : les appels passent alors par le serveur
  `npm run dev` / `npm run preview`.

## Comment ça marche

```
micro ─► reconnaissance vocale ─► texte
                                   │
                                   ▼
                     IA (réponse en flux, phrases annotées « [happy] … »)
                                   │
                    découpage en phrases (SentenceChunker)
                                   │
           ┌───────────────────────┴───────────────────────┐
           ▼                                               ▼
  synthèse vocale (phrase N+1 préparée            émotion → expression du visage
  pendant la lecture de la phrase N)               et posture de la tête
           │
           ▼
  analyse du son (AnalyserNode) ─► voyelles a/i/u/e/o ─► bouche de l'avatar
```

```
src/
├── main.ts                 assemblage de l'interface
├── settings.ts             réglages, fournisseurs, sauvegarde locale
├── avatar/
│   ├── stage.ts            scène three.js + VRM : pose, respiration, clignements, regard, émotions
│   ├── gestures.ts         lecture des animations VRMA, mélangées à l'animation procédurale
│   └── lipsync.ts          synchronisation labiale (son réel ou texte)
├── core/
│   ├── conversation.ts     orchestration écoute → IA → voix, interruptions, mains libres
│   ├── chunker.ts          découpe le flux en phrases prononçables
│   └── emotion.ts          balises d'émotion et nettoyage du texte (markdown, emojis…)
├── llm/                    clients IA (compatible OpenAI, Anthropic)
├── tts/                    moteurs de voix et file de lecture
├── stt/                    reconnaissance vocale (navigateur, Whisper + détection de silence)
└── ui/panel.ts             panneau de réglages
```

Commandes : `npm run dev` (développement), `npm run build` (version optimisée dans `dist/`),
`npm test` (tests unitaires), `npm run typecheck`, `npm run build-vrma` (regénère les animations fournies).

Pour déboguer, ajoute `?debug` à l'URL : l'objet `stage` est alors accessible dans la console.

## Sécurité

- Les clés API sont enregistrées dans le `localStorage` du navigateur, en clair. N'utilise pas l'application
  sur un appareil partagé avec des clés à gros budget, et fixe une limite de dépenses chez ton fournisseur.
- Le relais local (`/__proxy/`) relaie les requêtes vers n'importe quelle adresse. Avec `--host`, il est donc
  accessible depuis tout ton réseau local : ne l'expose pas sur Internet.

## Pistes pour aller plus loin

- Plus d'animations fournies (applaudir, révérence, réfléchir…) dans `scripts/build-vrma.mjs`
- Avatars Live2D (2D) avec `pixi-live2d-display`
- Mot d'éveil (« Hé Aiko ») et détection de voix plus fine (Silero VAD en WebAssembly)
- Mémoire à long terme (résumés de conversations sauvegardés)
- Application native (Capacitor pour Android/iOS, Tauri pour le bureau)
