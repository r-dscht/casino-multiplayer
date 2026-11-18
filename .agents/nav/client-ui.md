# Client UI, DOM-ID's, Controllers & CSS-Lagen

Alle frontend-code staat in `client/` zonder build-stap of module-bundler; scripts worden in vaste volgorde geladen onderin `client/index.html`.

## HTML Views & Modals in `client/index.html`

### Spelviews (`class="game-view-pane"`)
- `#roulette-view` — 3D-roulette (`#roulette-canvas-container`) & inzetbord (beheerd in `client/js/ui.js` en `client/js/three/Roulette3D.js`).
- `#blackjack-view` — 6-zits Blackjack-tafel (beheerd in `client/js/ui.js`).
- `#poker-view` — Texas Hold'em Poker (`client/js/poker.js`, `#poker-felt-stage`).
- `#crash-view` — Crash grafiek en auto-cashout (`client/js/crash.js`).
- `#slots-view` — 8 floor cabinets + Golden Fever + 5x3 rollen zonder Juich (`client/js/slots.js`, `#slots-fever-box`, `#slots-jackpot-pill`, `#slots-roll-history-list`).
- `#plinko-view` — Plinko piramide (`client/js/plinko.js`).
- `#hilo-view` — Solo Ladder + Live Zaal (`client/js/hilo.js`, `#btn-hilo-start`, `#btn-hilo-cashout`, `#hilo-salon-list`).
- `#racing-view` — Port Hercule Derby (`client/js/racing.js`, `#racing-canvas`, `#racing-runner-spotlight`, `#racing-paddock-grid`, `#racing-winner-pot-val`, `#racing-fixed-odds-val`, `#racing-commentary-text`, `#btn-place-racing-bet`, `#btn-racing-cheer`).
- `#mines-view` — Royal Mines Vault (`client/js/mines.js`, `#mines-board`, `#btn-mines-solo-start`, `#btn-mines-cashout`, `#mines-salon-list`).
- `#cross-view` — Monte Carlo Boulevard Cross (`client/js/cross.js`, `#cross-canvas`, `#btn-cross-start`, `#btn-cross-step`, `#btn-cross-cashout`, `#cross-salon-list`, `#cross-history-list`).
- `#avia-view` — AviaMasters Luchtvaart Arcade (`client/js/avia.js`, `#avia-canvas`, `#avia-live-counter`, `#avia-chain-bar`, `#btn-avia-fly`; tijdelijk verborgen met `.feature-wip-hidden` + `AVIA_WIP_ENABLED = false` in `client/js/app.js` zonder CPU-gebruik).

### Header, HUD & Actieve Modals
- Master-header ID's: `#pill-roulette`, `#pill-blackjack`, `#pill-poker`, `#pill-crash`, `#pill-slots`, `#pill-plinko`, `#pill-hilo`, `#pill-racing`, `#pill-mines`, `#pill-cross`, `#pill-avia` (WIP-verborgen), `#hud-phase-badge`, `#phase-title`, `#phase-timer`, `#hud-history-strip`.
- Service-HUD & Speler: `#btn-open-lottery` (`#hud-lottery-timer`, `#hud-lottery-pot`), `#btn-open-wheel` (`#hud-wheel-cooldown`), `#btn-open-bank`, `#hud-avatar-disc`, `#hud-player-name`, `#hud-player-chips`, `#btn-toggle-social`.
- Modals: `#onboarding-modal` (`#input-player-name`, `#input-player-password`, `#btn-enter-table`), `#inside-bets-modal`, `#bank-modal`, `#player-profile-modal`, `#poker-buyin-modal`, `#lottery-modal` (`#lottery-draw-status`, `#lottery-reel-stage`, `#lottery-fx-canvas`, `#lottery-reel-track`, `#lottery-draw-banner`, `#btn-buy-lottery-ticket`).
- Verborgen WIP-ankers (`.feature-wip-hidden`, intact laten voor tests): `#btn-open-market`, `#btn-open-exchange`, `#market-modal`, `#exchange-modal`, `#racing-modal`, `#gadgets-perks-dock` (`data-perks-hidden="true"`).

## Frontend Controllers (`client/js/`)
- `client/js/app.js` — Bootstrap na `DOMContentLoaded`; koppelt controllers en verzorgt `activateGameView`, `deactivateInactiveViews`, `hasUnsettledBets`, `getActiveBetGame` en `sessionStorage` tab-herstel (`casino_active_game`).
- `client/js/network.js` (`CasinoNetwork`) — Socket-wrapper, auto-reauth via `_lastAuthPayload`, `localStorage` backup (`saveClientBackup`, `getClientBackup`).
- `client/js/ui.js` (`CasinoUI`) — Onboarding, HUD-updates, `updatePhase` (`phaseMap`), sidebar chat/leaderboard, profielkleurstudio, Roulette- & Blackjack-DOM.
- `client/js/bank.js` (`CasinoBank`) — Bankmodal, P2P-leningen, inboxmeldingen en gratis rad.
- `client/js/lottery.js` (`CasinoLottery`) — `10-min` aftelklok met offline backup (`casino_lottery_backup`), `myPendingOfflineWin`-viering, 3-fasen `renderReel` met `_burstLotterySparks` op canvas.
- `client/js/shell.js` — Viewport-classificatie en responsive drawer-gedrag (`setSocial`, `classify`, `onResize`).

## CSS Architectuur (`client/css/`)
- `client/css/themes.css` — Kleurtokens en thema-variabelen (`data-theme="theme-obsidian"`, `data-theme="obsidian"`).
- `client/css/style.css` — Algemene stijlen, knoppen, modals, chat, Roulette/Blackjack-tafels.
- `client/css/layout.css` — Alle moderne game-views (`.slots-*`, `.hilo-*`, `.racing-*`, `.mines-*`, `.lottery-*`) en zero-scroll laptop-viewport media-queries (`max-height: 760px`).
- `client/css/shell.css` — Master-header, rail-layout, `.feature-wip-hidden` (`--shell-perk-h: 0px`) en responsieve schil.
