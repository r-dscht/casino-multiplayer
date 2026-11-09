# Monte Carlo Royale Multiplayer Casino — Test Infrastructure Specification

## 1. Overview & Test Philosophy
This document outlines the testing architecture, harness design, execution protocol, and verification standards for the **Monte Carlo Royale Luxury Multiplayer Casino** web application (`casino-multiplayer`), encompassing:
- **European Roulette** (Single-Zero 37 Pockets)
- **6-Seat Multiplayer Blackjack** (S17, Split, Double Down)
- **Authoritative 6-Seat No-Limit Texas Hold'em Poker** (C(7,5) Evaluator, Side Pots, Interactive Peek Toggle)
- **Plinko Game** (8-16 Rows, Low/Med/High Risk, 27 Calibrated Multiplier Tables, Cryptographic Random Walk, Room Drop Sync)
- **5x3 Luxury Slot Machine (Gokkasten)** (20 Fixed Paylines, 32-Stop Reel Strips, Wild Substitution, Free Spins 3x Multiplier, Progressive Jackpot Counter, Near-Miss Slowdown, Big-Win / Mega-Win Coin Bursts)
- **Hoger of Lager (Hi-Lo)** (Solo Ladder Mode, Cashout Anytime, Push/Redraw Tie Rule, Synchronized Multiplayer Community Deck, Dynamic Odds with 97.0% RTP)
- **Strict Bankroll & Chip Economy** (Permanent Removal of 10-Minute Recurring Faucet, Bankroll Conservation)
- **Aesthetic & Environmental Guardrails** (100% Silent Mode, Zero Unicode Emojis, Fit-to-Screen Laptop Zero-Scroll Bounds ~710px - 740px height)

### Core Test Principles:
1. **Opaque-Box & Requirement-Driven**: Tests interact with the casino application strictly from the outside—via HTTP/REST endpoints, typed Socket.io WebSocket connections, public interface contracts, and filesystem audits.
2. **Zero Facade / No Cheating**: All tests execute genuine mathematical and state machine logic. No trivial assertions (`assert.ok(true)`), no hardcoded passes, and no bypassed business logic. Every test asserts authoritative expected outputs derived from mathematical ground truth and official game rules.
3. **Progressive Testability**: Tests are designed to be self-contained and independently verifiable across parallel development tracks. Tests dynamically verify newly landing modules while validating interface contracts and mathematical invariants without stalling or failing.
4. **Systematic Test Design Methodologies**: Test scenarios are derived using formal software engineering methodologies:
   - **Category-Partition Testing**: Partitioning input domains, table configurations, player actions, and wallet operations into exhaustive, mutually exclusive equivalence classes.
   - **Boundary Value Analysis (BVA)**: Probing off-by-one limits, minimum/maximum rows, extreme random walk paths, extreme card ranks (Ace/Deuce), minimum raise deltas, short-stack all-ins, exact stack zeroes, scatter boundaries, and heads-up transitions.
   - **Pairwise & Combinatorial Testing**: Verifying interactions across orthogonal features—multi-game navigation bet locks, unified bankroll ledger synchronization, multi-game presence tracking, mid-hand disconnect/reconnect with peek toggle, and turn timer countdown anti-stall.
   - **Workload & Stress Testing**: Simulating realistic multi-player concurrent casino journeys across Plinko, Slots, Hi-Lo, and Poker with atomic disk persistence.
5. **Strict Guardrails Enforcement**: Automated forensic scanners enforce 100% silent design (zero audio files, zero Web Audio API, zero `<audio>` elements), zero unicode emojis (pure SVG card suits and slot icons), and zero-scroll laptop viewport bounds.
6. **Zero External Test Dependencies**: Built entirely on Node.js's native test runner (`node:test`) and assertion library (`node:assert/strict`), executing hundreds of tests in milliseconds without heavy third-party framework overhead.

---

## 2. Test Architecture

The testing architecture is organized into unit, integration, and opaque-box end-to-end layers across all casino game modules:

```
casino-multiplayer/
├── tests/
│   ├── unit/
│   │   ├── rouletteMath.test.js          # Pure Roulette math, 37 pockets, 2.7027% house edge
│   │   ├── rouletteEngine.test.js        # Roulette state transitions (BETTING, SPINNING, PAYOUT)
│   │   ├── blackjackRules.test.js        # Dynamic Ace 1/11 valuation, Soft 17 rules, bust detection
│   │   ├── blackjackDeck.test.js         # 6-deck shoe (312 cards), crypto Fisher-Yates shuffle
│   │   ├── blackjackEngine.test.js       # S17 6-seat blackjack state machine, dealer AI, turn timers
│   │   ├── pokerDeck.test.js             # 52-card deck, crypto Fisher-Yates shuffle, burn cards
│   │   ├── pokerRules.test.js            # 7-card evaluator, 10 hand ranks, wheel straight, tie-breakers
│   │   ├── pokerPotManager.test.js       # Side pots, multiple all-ins, dead money, odd chips
│   │   ├── pokerEngine.test.js           # 6-seat NL state machine, action validation, delta-raise, turn timeout
│   │   ├── playerManager.test.js         # Player registry, 10,000 chip bankroll, atomic ledger
│   │   ├── bankManager.test.js           # P2P transfers, loan agreements, win deduction amortizations
│   │   ├── accountPersistence.test.js    # Disk storage, password authentication
│   │   ├── sessionPersistence.test.js    # Bearer tokens, atomic swap, auto-recovery
│   │   ├── clientUiUx.test.js            # Monogram generation, 12-hue palette, toast messages
│   │   ├── socketDefense.test.js         # Malformed payloads, rate-limiting, crash defense
│   │   └── tunnel.test.js                # Cloudflare Quick Tunnel extraction & bypass logic
│   ├── integration/
│   │   ├── serverRoute.test.js           # HTTP endpoints, static delivery, silent & brand audit
│   │   ├── socketEvents.test.js          # Socket connection, betting, payouts, chat broadcasts
│   │   ├── playerProfileSockets.test.js  # Profile fetching, avatar/color customization
│   │   ├── bankSockets.test.js           # P2P loan socket events & notifications
│   │   ├── pokerSockets.test.js          # Multi-player seat join, betting rounds, hole card masking
│   │   ├── pokerBuyInCashout.test.js     # Two-tier wallet buy-in, rebuys, and clean cashout to playerManager
│   │   └── pokerBetLock.test.js          # Navigation bet lock on active poker hands
│   └── e2e/
│       ├── harness.js                    # Ephemeral test server & instrumented Socket client
│       ├── e2e_tier1_features.test.js    # Roulette Tier 1: Feature Coverage (38 tests)
│       ├── e2e_tier2_boundaries.test.js  # Roulette Tier 2: Boundary & Corner Cases (30 tests)
│       ├── e2e_tier3_combinations.test.js# Roulette Tier 3: Cross-Feature Interactions (9 tests)
│       ├── e2e_tier4_scenarios.test.js   # Roulette Tier 4: Real-World Scenarios (5 tests)
│       ├── e2eCasinoBlackjackSuite.test.js # Comprehensive 4-Tier Blackjack & Casino Suite (58 tests)
│       ├── e2eCasinoPokerSuite.test.js   # Comprehensive 4-Tier Texas Hold'em Poker Suite (80 tests)
│       └── e2eNewCasinoGamesSuite.test.js# Comprehensive 4-Tier Plinko, Slots, Hi-Lo, Poker Fixes, Faucet Suite (83 tests)
```

---

## 3. Feature Inventory Coverage Matrix (Features 1–100)

The matrix below maps all 100 features from `PROJECT.md` to their corresponding automated test suites:

| # | Feature Name | Primary Scope | Test Suite Location | Coverage Type |
|---|---|---|---|---|
| 1 | Dedicated Project Directory | Root layout | `tests/integration/serverRoute.test.js` | Integration |
| 2 | Brand Sanitization & Luxury Styling | Theme/Copy | `tests/integration/serverRoute.test.js`, `tests/e2e/*.test.js` | E2E Audit |
| 3 | 100% Silent Client ("geen audio") | Audio removal | `tests/integration/serverRoute.test.js`, `tests/e2e/*.test.js` | E2E Forensic |
| 4 | Low-Poly Procedural 3D Wheel | Three.js geometry | `tests/integration/serverRoute.test.js` | Integration |
| 5 | Single-Texture Pocket Atlas | Canvas atlas | `tests/integration/serverRoute.test.js` | Integration |
| 6 | Dual-Rate Thermal Throttling | 30/60 FPS clamp | `tests/integration/serverRoute.test.js` | Integration |
| 7 | Synchronized Animation Physics | Ball trajectory | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 8 | Responsive Viewport & Camera | CSS/DOM | `tests/integration/serverRoute.test.js` | Integration |
| 9 | European Betting Grid | 37 pockets | `tests/unit/rouletteMath.test.js` | Unit |
| 10 | Multi-Player Chip Placement | Live board | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 11 | Player Onboarding Modal | Registration | `tests/unit/playerManager.test.js`, `tests/e2e/e2e_tier1_features.test.js` | Unit/E2E |
| 12 | 10,000 Chip Starting Balance | Bankroll | `tests/unit/playerManager.test.js`, `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Unit/E2E |
| 13 | Real-Time Chat & Event Feed | Multiplayer chat | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 14 | European Roulette Math Engine | Odds & payouts | `tests/unit/rouletteMath.test.js` | Unit |
| 15 | Authoritative State Machine | Roulette phases | `tests/unit/rouletteEngine.test.js` | Unit |
| 16 | Server Clock Synchronization | Timestamps | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 17 | Real-Time Socket Protocol | Sockets | `tests/integration/socketEvents.test.js` | Integration |
| 18 | Disconnection & Edge Handling | Active bets | `tests/e2e/e2e_tier1_features.test.js` | E2E |
| 19 | Windows Cloudflare Quick Tunnel | `cloudflared` | `tests/unit/tunnel.test.js` | Unit |
| 20 | 1-Click Cloud Deployment | Docker/Render | `tests/integration/serverRoute.test.js` | Integration |
| 21 | Automated Unit & Integration Tests| Core engine | `tests/unit/*.test.js`, `tests/integration/*.test.js` | Full Suite |
| 22 | Requirement-Driven E2E Suite | 4-Tier E2E | `tests/e2e/*.test.js` | E2E |
| 23 | Persistent Session Authentication | Bearer tokens | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Unit/E2E |
| 24 | Resilient Atomic Disk Storage | `players.json` | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Unit/E2E |
| 25 | Refresh Session Auto-Recovery | Browser reload | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 26 | Multi-Game Player Presence | Lobby/Roulette/BJ/Poker | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 27 | Server Navigation Bet Lock | Active bets | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 28 | 6-Deck Cryptographic Shoe | 312 cards | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 29 | Pure Blackjack Math & Scoring | Dynamic Ace/S17 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 30 | Standard Blackjack Player Actions | Hit/Stand/Dbl/Splt | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 31 | Authoritative S17 Dealer AI | Dealer hits <=16 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 32 | 6-Seat State Machine & Turn Timers| Clockwise turns | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 2 |
| 33 | Dealer Hole Card Masking | Anti-cheat | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 34 | Enhanced Avatar & Monogram System| Monograms | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 35 | Active Turn & Seated Status Badges| Turn pulses | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 36 | Semicircular 6-Seat Blackjack Arc | Table seats | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 37 | Tabbed Casino Chat System | Global/Table | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 38 | Zero Emoji & Pure SVG Card Suits | Vector suits | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 39 | 3D Card Dealing Micro-animations | Perspective flip | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 40 | Win Shimmers & Chip Balance Ticker| Ticker animation | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 4 |
| 41 | Regal Outcome Banners | Victory banners | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 |
| 42 | Client Navigation Lock Interceptor | Lock toasts | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | E2E Tier 1 & 3 |
| 43 | Comprehensive E2E Testing Suite | Tiers 1-4 | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Complete E2E |
| 44 | Forensic Integrity Audit | Security/Brand | `tests/e2e/e2eCasinoBlackjackSuite.test.js` | Forensic E2E |
| 45 | 52-Card Cryptographic Poker Deck | Single deck & burns | `tests/unit/pokerDeck.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 46 | 7-Card Hand Evaluation Algorithm | C(7,5)=21, 10 ranks | `tests/unit/pokerRules.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 47 | Side Pot Partitioning Engine | Cumulative tiers | `tests/unit/pokerPotManager.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 48 | No-Limit Hold'em State Machine | WAITING..SHOWDOWN | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 49 | No-Limit Delta Raise & Reopening | Min-raise delta | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 50 | Authoritative Private Hole Card Masking | Anti-cheat masking | `tests/integration/pokerSockets.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 51 | 15s Poker Turn Timer & Anti-Stall| Auto-check/fold | `tests/unit/pokerEngine.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Unit/E2E |
| 52 | Two-Tier Cash Game Wallet | Buy-in/Rebuy/Cashout| `tests/integration/pokerBuyInCashout.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js`| Integ/E2E |
| 53 | Multi-Game Poker Presence Whitelist| Whitelist 'POKER' | `tests/integration/betLockPresence.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 54 | Backward-Compatible Bet Lock | 4th arg optional | `tests/integration/pokerBetLock.test.js`, `tests/e2e/e2eCasinoPokerSuite.test.js` | Integ/E2E |
| 55 | Real-Time Poker Socket Protocol | Typed poker events | `tests/integration/pokerSockets.test.js` | Integration |
| 56 | Disconnect Graceful Seat Reservation| Reconnection window| `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 3 |
| 57 | Multi-Table Poker Support | poker_1, poker_2 | `tests/integration/pokerSockets.test.js` | Integration |
| 58 | Top Header Poker Navigation | #pill-poker | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 59 | 6-Seat Elliptical Felt Stage | 1080x540 felt UI | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 60 | Hero Seat Ergonomics & Badges | Radial seat layout | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 61 | Community Cards & Dynamic Pot UI | 5 card slots & pots | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 62 | Poker Action Bar & Bet Sizing Slider| Fold/Check/Bet/Raise| `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 63 | Visual Turn Timer Bar | 15s countdown bar | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 64 | Cash Game Buy-In Modal | 20 BB - 100 BB | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 |
| 65 | Poker Tabbed Chat Integration | table:poker room | `tests/e2e/e2eCasinoPokerSuite.test.js` | E2E Tier 1 & 3 |
| 66 | 100% Silent Poker Client | Zero audio files/APIs| `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 67 | Zero Emoji Pure SVG Vector Suits | SVG #suit-* | `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 68 | Monte Carlo Luxury Aesthetic | Emerald/gold theme | `tests/e2e/e2eCasinoPokerSuite.test.js` | Guardrails |
| 69 | Comprehensive Poker E2E Suite | 4-Tier Poker E2E | `tests/e2e/e2eCasinoPokerSuite.test.js` | Complete E2E |
| 70 | Regression Safety (382 Tests Pass)| Zero regressions | `tests/**/*.test.js` (npm test) | Full Suite |
| 71 | Forensic Integrity Audit | Security/Brand/Rules| `tests/e2e/e2eCasinoPokerSuite.test.js` | Audit Gate |
| 72 | Permanent Faucet & Bankruptcy Removal | Remove 10-min faucet in UX | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 73 | Poker Hole Card Visibility Fix | Hero hole card unmasking | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 3 |
| 74 | Interactive "Peek / Hide Cards" Toggle | Toggle button & 3D flip | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 3 |
| 75 | Elimination of Auto-Seating Bugs | Strict seatIndex validation | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 76 | Poker Reconnection State & Pacing | Reset `seat.player.connected = true` | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 3 |
| 77 | 5x3 Luxury Slot Machine Engine | 20 paylines, 32 stops, 96.79% RTP | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 78 | Luxury Slot Symbol Set (0 Emojis) | Pure SVG icons (Emerald, Gold, Diamond...) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & Guardrails |
| 79 | Free Spins Bonus Mechanics | 3+ Scatters award 10 FS @ 3x | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 80 | Progressive Jackpot Counter | Seeds 10k, 1% increment, Line 1 5-Crests | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 81 | Near-Miss Scatter Anticipation Slowdown | 2 scatters trigger anticipation | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 82 | Celebratory Big-Win / Mega-Win Coin Burst | Wins >=20x and >=50x | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 |
| 83 | Casino Floor Machine Presence & Win Ticker | 8 machines & live win socket ticker | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 |
| 84 | Plinko Configurable Peg Grid | 8 to 16 selectable rows (9-17 bins) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 85 | Plinko Risk Levels & Calibrated Multipliers | Low, Med, High (27 arrays, 96.8-97.2% RTP) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 86 | Server-Authoritative Random Walk Engine | Crypto random walk binary paths | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 87 | Real-Time Multiplayer Room Drop Sync | Broadcast `plinko_ball_dropped` | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 |
| 88 | Plinko High-Dopamine Visual Feedback | Peg bounce lighting & neon bursts | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 |
| 89 | Hi-Lo Dynamic Odds & Math Model | Exact probabilities, 97.0% RTP ($0.97/P$) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 90 | Hi-Lo Solo Ladder Mode | Streak ladder & cashout anytime | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 91 | Hi-Lo Push / Redraw Tie Preservation | Same-rank card pushes, preserves pot | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 92 | Hi-Lo Multiplayer Community Mode | Synchronized rounds (12s/3s/4s) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 & 2 |
| 93 | Hi-Lo Suspenseful 3D Card Reveal Staging | 3D perspective flip & golden glow | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 1 |
| 94 | Fit-to-Screen Laptop Zero-Scroll Architecture | Bounds $\le 640\text{px}$, 710-740px viewport | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | Guardrails |
| 95 | Header Navigation Integration | Header pills (#pill-slots, #pill-plinko, etc) | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 3 |
| 96 | Multi-Game Presence & Bet Lock Extension | Whitelist ('SLOTS', 'PLINKO', 'HILO') | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | E2E Tier 3 |
| 97 | 100% Silent Mode Guardrail | 0 audio files & 0 Web Audio calls | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | Guardrails |
| 98 | Zero Unicode Emojis Guardrail | Pure SVG vectors & typography | `tests/e2e/e2eNewCasinoGamesSuite.test.js` | Guardrails |
| 99 | Comprehensive E2E Testing Suite | 4-tier opaque-box E2E suites | `tests/e2e/*.test.js` | E2E Track |
| 100 | 100% Pass Rate on 600 Baseline Tests | All baseline tests continue to pass | `npm test` | Regression Verification |

---

## 4. 4-Tier Test Methodology: Plinko, Slots, Hi-Lo, Poker Fixes & Guardrails

The comprehensive test suite in `tests/e2e/e2eNewCasinoGamesSuite.test.js` evaluates all new game engines and platform enhancements across 4 formal testing tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NEW CASINO GAMES E2E TEST METHODOLOGY                    │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ 1. Category-Partitioning      │ Happy paths in isolation for Plinko, Slots, │
│    (Tier 1: Feature Coverage) │ Hi-Lo, Poker Visibility, Faucet Removal     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 2. Boundary Value Analysis    │ Min/Max Rows, Out-of-bounds, Extremes,      │
│    (Tier 2: Boundary/Corners) │ Ace/Deuce, Near-Miss Scatters, Push Ties    │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 3. Pairwise & Combinatorial   │ Multi-Game Navigation Locks, Bankroll       │
│    (Tier 3: Combinations)     │ Synchronization, Reconnection with Peek     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 4. Workload & Simulation      │ Full Multi-Game Player Session Journey,     │
│    (Tier 4: Real-World)       │ Plinko -> Slots -> Hi-Lo -> Poker -> Disk   │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ 5. Automated Guardrails       │ 0 Audio Files/APIs, 0 Emojis, Zero-Scroll   │
│    (Forensic Verification)    │ Viewport Constraints (~710px - 740px)       │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### 4.1 Tier 1: Feature Coverage (Category-Partition Testing)
- **F1: Plinko Game (6 tests)**:
  - Rows 8-16 grid geometry ($R+1$ bottom slots).
  - 27-array calibrated multiplier RTP proof (96.8% - 97.2%).
  - Cryptographic random walk binary trajectory generation.
  - Landing slot computation ($k = \sum d_i$).
  - Server-authoritative payout formula ($\lfloor \text{bet} \times \text{multiplier} \rfloor$).
  - Real-time multiplayer ball drop socket payload broadcast.
- **F2: 5x3 Luxury Slot Machine (10 tests)**:
  - 5x3 reel grid generation and 32-stop reel strip indexing.
  - 20 fixed paylines evaluation from left to right.
  - Wild substitution for standard paying symbols.
  - Wild non-substitution for Scatter symbols.
  - 3+ Scatter bonus trigger: 10, 15, 20 Free Spins with instant 5x, 25x, 100x payouts.
  - Free spins 3x line payout multiplier.
  - Progressive jackpot counter: 10,000 seed + 1% contribution.
  - Progressive jackpot award on Payline 1 with 5 CRESTs/WILDs.
  - Win tier classifications: Nice Win ($\ge 10\times$), Big Win ($\ge 20\times$), Mega Win ($\ge 50\times$).
  - Floor presence (8 machines) and live win announcement ticker.
- **F3: Hoger of Lager (Hi-Lo) (8 tests)**:
  - Rank hierarchy ($2 \dots 14$).
  - Dynamic odds calculation matching exact conditional probability $P = N_{\text{match}}/N_{\text{total}}$.
  - Payout multipliers yielding fair 97.0% RTP ($0.97 / P$).
  - Solo mode streak ladder: wager, prediction, multiplier accumulation, cashout anytime.
  - Push/redraw tie preservation: same-rank card preserves streak and accumulated pot.
  - Multiplayer community mode: synchronized rounds (BETTING 12s -> REVEALING 3s -> PAYOUT 4s).
  - Equal prediction market paying 97% RTP payout on matching rank.
  - Automatic cryptographic reshuffle when remaining deck $< 10$ cards.
- **F4: Poker Fixes & Hole Card Visibility (6 tests)**:
  - Unmasked hole card delivery to seated hero player via private unicast.
  - Opponent hole card masking with `{ hidden: true }` in public broadcast.
  - Interactive "Peek / Hide Cards" toggle button state management.
  - Hidden peek state using `data-card-sig="peek_hidden"` without card loss.
  - Elimination of auto-seat assignment for table observers.
  - Reconnection restoring `seat.player.connected = true` and updating `socketId`.
- **F5: Chip Economy & Faucet Removal (4 tests)**:
  - Absence of 10-minute chips faucet UI tab and claim button in player UX.
  - Absence of recurring client bailout countdown interval.
  - Server rejection of unauthorized `bank_claim_bailout` requests in production.
  - Bankroll conservation: balances update strictly through wagers, game outcomes, and cashouts.

### 4.2 Tier 2: Boundary Value Analysis (Boundary & Corner Cases)
- **B1: Plinko Boundaries (9 tests)**:
  - Minimum rows boundary (8 rows = 9 bins).
  - Maximum rows boundary (16 rows = 17 bins).
  - Extreme left trajectory (all 0s) hitting Slot 0 maximum multiplier.
  - Extreme right trajectory (all 1s) hitting Slot R maximum multiplier.
  - Center bin trajectory hitting minimum multiplier.
  - Out-of-bounds row counts (<8, >16, fractional) rejected with `INVALID_ROWS`.
  - Invalid risk strings rejected.
  - Zero, negative, or non-numeric bet amounts rejected.
  - Wagers exceeding player bankroll rejected with `INSUFFICIENT_FUNDS`.
- **B2: Slots Boundaries (9 tests)**:
  - Zero or negative line bets rejected.
  - Total wagers exceeding balance rejected.
  - Clamping paylines count within $[1, 20]$.
  - Near-miss scatter boundary: exactly 2 Scatters triggers anticipation slowdown without free spins.
  - Scatter thresholds: 3 awards 10 spins; 4 awards 15; 5 awards 20.
  - Wild non-substitution on Scatter (2 Scatters + 1 Wild does not trigger bonus).
  - Progressive jackpot line boundary: 5 CRESTs on Payline 2 awards standard 2700x line bet, NOT jackpot.
  - Free spins retrigger: landing 3 Scatters during bonus round adds exactly +5 free spins.
  - Multiple concurrent payline wins correctly aggregate total payout.
- **B3: Hi-Lo Boundaries (8 tests)**:
  - Ace boundary: 0 higher cards ($P(\text{Higher}) = 0$, multiplier = 0).
  - Deuce boundary: 0 lower cards ($P(\text{Lower}) = 0$, multiplier = 0).
  - Solo mode cashout at streak 0 returns initial bet without profit or loss.
  - Solo mode incorrect prediction terminates ladder and loses pot.
  - Consecutive push/redraw sequences preserve streak and pot continuously.
  - Multiplayer round transition: bets placed after BETTING countdown expires are rejected.
  - Zero, negative, or excessive bet amounts rejected.
  - Invalid prediction string rejected with `INVALID_PREDICTION`.
- **B4: Poker & Bankroll Boundaries (5 tests)**:
  - Claiming seat with null, negative, or index $\ge 6$ rejected with `INVALID_SEAT`.
  - Modal initialization with `pendingBuyInSeat = null` prevents accidental Seat 0 buy-in.
  - Spectator observing poker table has `seatIndex === -1` and 0 chips committed.
  - Bailout claim with balance $\ge 10$ chips rejected.
  - Production bailout claim with balance $< 10$ chips rejected with faucet disabled notice.

### 4.3 Tier 3: Pairwise & Combinatorial Testing
- **C1: Multi-Game Navigation Bet Lock (5 tests)**:
  - Active Slot spin locks navigation with `CANNOT_LEAVE_ACTIVE_BETS`.
  - Active Free Spins bonus locks navigation until all bonus spins complete.
  - Active Hi-Lo Solo ladder locks navigation until player cashes out or loses.
  - Active Hi-Lo Multiplayer bet locks navigation until round settlement.
  - Settling all active bets instantly releases navigation lock across all games.
- **C2: Multi-Game Bankroll & Presence Synchronization (5 tests)**:
  - Presence whitelist supports `'SLOTS'`, `'PLINKO'`, `'HILO'`, `'POKER'`, `'BLACKJACK'`, `'ROULETTE'`, `'LOBBY'`.
  - Winnings from Plinko are immediately available for Slot spins.
  - Winnings from Slots are immediately available for Hi-Lo ladder.
  - Winnings from Hi-Lo are immediately available for Poker table buy-in.
  - Zero-discrepancy atomic accounting across rapid multi-game transitions ($\Delta \text{Balance} = \sum \text{Payouts} - \sum \text{Wagers}$).
- **C3: Poker Disconnection, Reconnection, and Peek Toggle (3 tests)**:
  - Mid-hand disconnect preserves seat and table stack without auto-cashout.
  - Reconnecting with session token updates socket and restores active seat.
  - Reconnected player can toggle Peek / Hide to view hole cards without leaking to opponents.

### 4.4 Tier 4: Real-World Workload Scenarios
- **W1: Complete Casino Player Journey (Multi-Game Session Simulation) (1 test)**:
  - Player onboarded with 10,000 chips.
  - Plays 3 Plinko drops across Low, Medium, and High risk profiles.
  - Plays 5x3 Slots spin with 20 paylines, evaluates line wins, and increments jackpot.
  - Plays Hi-Lo Solo ladder, encounters correct guesses, push/redraw tie, and cashes out.
  - Buys into Poker table, receives hole cards, toggles Peek state, folds, and cashes out.
  - Verifies session persistence: exact zero chip loss, atomic balance consistency.

### 4.5 Forensic Guardrails Verification (R6)
- **G1: 100% Silent Mode (Zero Audio)**:
  - Scans repository for audio files (`.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.weba`) (asserts 0 found).
  - Scans client codebase for Web Audio API references (`AudioContext`, `createOscillator`, `<audio>`, `new Audio`) (asserts 0 found).
- **G2: Zero Unicode Emojis**:
  - Scans client files (HTML, JS, CSS) for unicode emoji code point ranges (asserts 0 found).
  - Confirms pure SVG vectors for card suits, slot symbols, plinko pins, and poker icons.
- **G3: Fit-to-Screen Laptop Zero-Scroll Viewport Bounds**:
  - Verifies `.master-header` is $\le 46\text{px}$ under `@media (max-height: 760px)`.
  - Verifies total component bounding boxes $\le 640\text{px}$ fitting within 710px - 740px viewports without vertical scrollbars.

---

## 5. How to Run the Tests

```bash
# 1. Run the new E2E New Casino Games Suite (Plinko, Slots, Hi-Lo, Poker Fixes, Faucet, Guardrails):
cd casino-multiplayer
node --test tests/e2e/e2eNewCasinoGamesSuite.test.js

# 2. Run the E2E Texas Hold'em Poker Suite:
cd casino-multiplayer
node --test tests/e2e/e2eCasinoPokerSuite.test.js

# 3. Run the E2E Blackjack & Casino Suite:
cd casino-multiplayer
node --test tests/e2e/e2eCasinoBlackjackSuite.test.js

# 4. Run all Casino E2E Suites combined:
cd casino-multiplayer
node --test tests/e2e/*.test.js

# 5. Run full project test suite (all 683 tests):
cd casino-multiplayer
npm test
```
