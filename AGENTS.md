# AGENTS.md — Casino Multiplayer Navigatie & Werkregels

Real-time multiplayer webcasino (*Le Grand Casino / Monte Carlo Royale*) met Express, Socket.IO, Three.js (`Roulette3D`) en in-memory JSON-opslag.

## Architectuur in één oogopslag
- Boot: `server/index.js` -> `server/app.js` (statische `client/` + `/health`) + `server/socket.js` (`setupSocket`).
- Realtime: `client/js/network.js` (`CasinoNetwork`) <-> `server/socket.js` -> engines in `server/game/`.
- Frontend: `client/index.html` + `client/js/app.js` (view-switching/nav-locks) + `client/js/ui.js` (`CasinoUI`) + losse spelcontrollers in `client/js/`.
- Opslag: `server/data/` (`players.json`, `bank.json`, `lottery.json`, plus `.gitignore` testmappen).

## Werkwijze (Tokenbesparing)
1. Open eerst alleen de relevante detailkaart hieronder voordat je grote bestanden zoals `server/socket.js`, `client/index.html`, `client/js/ui.js` of CSS doorzoekt.
2. Zoek in code met `rg`/grep op sectiekop, klassenaam, methodenaam, eventnaam of `#id` en lees uitsluitend het benodigde codeblok.
3. Gebruik in deze documentatie nooit vaste regelnummers; houd ankers symbool- en sectiegericht.

## Modulaire Detailkaarten (`.agents/nav/`)
- Spelengines, constanten & RTP-wiskunde: `.agents/nav/games-math.md`
- Socket.IO protocol, secties, events & navigatie-locks: `.agents/nav/socket-events.md`
- HTML views, modals, DOM-ID's, controllers & CSS-lagen: `.agents/nav/client-ui.md`
- Spelerssessies, Bank/Leningen, offline Loterij & gerichte tests: `.agents/nav/state-bank-tests.md`

## Verplichte Werkregels
- Draai na elke wijziging de volledige testsuite en toon alleen samenvatting + gefaalde tests.
- Voeg zelf tests toe voor nieuwe features en bugfixes.
- Pas een bestaande test alleen aan als het gedrag bewust verandert, en meld dat.
- Werk de relevante kaart kort bij als structuur, events of ID's veranderen.
- Antwoord kort, zonder inleiding of herhaling.

## Casino-Invariants & Beveiliging
- **100% Stil & Schoon**: geen audiobestanden of audio-API's, geen Unicode-emoji's in code of markup, alleen luxe Monte Carlo-thema zonder externe gamemerken.
- **Kansen & Features**: `~2%` huisvoordeel (`98%` RTP) op Crash, Mines, Hi-Lo, Plinko, Slots, Paardracen en Roulette (`26%` Zero Shield); `0%` huisvoordeel en `10-min` ronde op Staatsloterij. Juich-actie bestaat alleen bij Paardracen; Hi-Lo heeft alleen Solo Ladder.
- **Data-hygiëne**: commit nooit runtime data of testdumps onder `server/data/`.

## Snelle Commando's
- Volledige testsuite: `npm test` (of vanuit bovenliggende map `npm --prefix casino-multiplayer test`)
- Enkel testbestand: `node --test tests/unit/projectNavDocs.test.js`
- Lokale server starten: `npm start` / dev met auto-reload: `npm run dev`
