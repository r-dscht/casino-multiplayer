# European Roulette Multiplayer Casino — Test Infrastructure Specification

## 1. Overview
This document outlines the testing architecture, harness design, execution protocol, and verification standards for the Modern 3D Multiplayer European Roulette Casino web application.

The test infrastructure is built entirely on Node.js's native test runner (`node:test`) and assertion library (`node:assert/strict`), eliminating bloated external test frameworks while delivering microsecond test execution speeds and native asynchronous event handling.

---

## 2. Test Architecture

The testing suite is structured across two complementary tiers:
1. **Unit Verification Layer** (`tests/unit/`): Validates pure mathematical calculation, 37-pocket geometry, bet odds/multipliers, 2.7027% house edge invariance, and atomic balance mutations.
2. **Opaque-Box E2E Verification Layer** (`tests/e2e/`): Requirement-driven, opaque-box tests interacting with the application strictly from the outside over real HTTP/REST endpoints and typed Socket.io WebSocket connections.

```
casino-multiplayer/
└── tests/
    ├── unit/
    │   ├── rouletteMath.test.js        # Pure betting math, odds, 2.7027% house edge, 60 splits, 23 corners
    │   └── playerManager.test.js       # Player registry, 10,000 chips starting bankroll, atomic ledger
    └── e2e/
        ├── harness.js                  # Ephemeral in-process test server & instrumented Socket client
        ├── e2e_tier1_features.test.js  # Tier 1: Feature Coverage (>=5 tests per core feature)
        ├── e2e_tier2_boundaries.test.js# Tier 2: Boundary & Corner Cases (>=5 tests per area)
        ├── e2e_tier3_combinations.test.js # Tier 3: Cross-Feature Interactions & Multi-Player Concurrency
        └── e2e_tier4_scenarios.test.js # Tier 4: Real-World Application Scenarios (Full Player Journeys)
```

---

## 3. Systematic 4-Tier Opaque-Box Methodology

The E2E suite follows a rigid 4-tier opaque-box testing hierarchy:

### Tier 1: Feature Coverage (`e2e_tier1_features.test.js`)
Validates every core feature in isolation across all primary happy paths (>= 5 tests per feature):
- **Feature 1: HTTP Server, Static Delivery & Luxury Theme Sanitization**: Healthcheck endpoint (`GET /health`), Express trust proxy (`trust proxy: 1`), brand sanitization (zero GTA or Diamond Casino references), 100% silent design ("geen audio"), and WebSocket upgrade handshakes.
- **Feature 2: Player Onboarding & Bankroll Initialization**: `join_table` protocol, 10,000 chips starting bankroll, initial `table_state` delivery, `player_joined` room broadcasts, and system chat greeting.
- **Feature 3: Standard Inside & Outside Bet Placement**: Straight (0-36), Split (60 pairs), Street (14 rows/trios), Corner (23 squares/basket), Six Line (11 lines), Columns (1-3), Dozens (1-3), Red/Black, Even/Odd, Low/High, atomic chip deduction, and `bet_placed` broadcasts.
- **Feature 4: Clear Bets & Chip Restoration**: Single bet refund, multi-bet aggregate sum refund, `chips_update` event delivery, `bets_cleared` room broadcast with updated table totals, and immediate subsequent bet placement.
- **Feature 5: Real-Time Chat & System Logging**: Multi-player chat broadcasting, metadata integrity (sender, color, timestamp, `isSystem: false`), chat history buffer preservation for newcomers, CASINO system announcements, and HTML entity XSS sanitization.
- **Feature 6: Authoritative State Machine & Clock Synchronization**: Periodic 1s countdown ticks (`phase_tick`), BETTING -> SPINNING -> PAYOUT transitions, single-zero European pocket constraints ($N \in [0, 36]$), `round_result` evaluation, and 15-entry round history buffer.
- **Feature 7: Disconnection & Session Persistence**: `player_left` room notification, system chat leaver log, mid-round bet retention across disconnects, automatic payout credit for disconnected players, and memory bankroll persistence.

### Tier 2: Boundary & Corner Cases (`e2e_tier2_boundaries.test.js`)
Validates limits, boundary coordinates, zero-pocket geometry, phase locking, and adversarial inputs (>= 5 tests per area):
- **Area 1: Financial & Chip Balance Boundaries**: `INSUFFICIENT_FUNDS` rejection when bet > chips, 10,000 chips all-in bet acceptance, 0 chip balance rejection, cumulative over-budget rejection, zero/negative chip rejection (`INVALID_AMOUNT`), and fractional/float/string rejection (`INVALID_AMOUNT`).
- **Area 2: Bet Coordinates & Zero-Adjacent Combinations**: Pocket 0 straight bet, zero-adjacent splits ([0,1], [0,2], [0,3]), zero-trio streets ([0,1,2], [0,2,3]), First Four basket corner ([0,1,2,3]), out-of-range straight bets (-1, 37, 100 rejected with `OUT_OF_RANGE`), non-adjacent split rejection (`INVALID_SELECTION`), invalid dozen/column rejection, and max coordinate boundaries ([35, 36], [32, 33, 35, 36], six-line [31..36]).
- **Area 3: Phase Locking & Transition Boundaries**: `BETS_CLOSED` error when betting in `SPINNING` phase, `BETS_CLOSED` error in `PAYOUT` phase, `clear_bets` lock in `SPINNING` and `PAYOUT`, and countdown expiration lock at $t \le 0$.
- **Area 4: Chat Input & Sanitization Boundaries**: Empty string `""` and whitespace `"    "` suppression, 150-character message truncation, adversarial XSS injection escaping (`<script>alert(document.cookie)</script>` -> `&lt;script&gt;...`), nested HTML tag sanitization, 16-character display name truncation, and display name HTML tag stripping.
- **Area 5: Zero (0) Green Pocket Sweep Outcome**: 0 payout for all outside even-money bets, 0 payout for all columns and dozens, 36x gross payout (35:1 profit) for straight 0, 18x payout for split covering 0 vs 0 for non-zero split, and 9x payout for First Four corner covering 0 vs 0 for non-zero corner.

### Tier 3: Cross-Feature Combinations (`e2e_tier3_combinations.test.js`)
Validates concurrent pairwise interactions, race condition prevention, and multi-player dynamics:
- Simultaneous bets by multiple players on the exact same straight number cell.
- Interleaved real-time chat messages and bet placement without socket event starvation.
- Chatting permitted during `SPINNING` and `PAYOUT` phases while betting remains securely locked.
- Player disconnect during mid-spin, authoritative payout resolution, and balance recovery upon reconnect.
- Multi-player conflicting bets (Red vs Black vs Green 0 vs Even) resolved in a single atomic transaction.
- Independent `clear_bets` by one player while concurrent players' bets remain intact on the table.
- Admin `/spin` command interrupting BETTING countdown and locking incoming bets.
- Rapid-fire concurrent bets (10 in parallel) processed atomically without ledger corruption.
- In-game bankroll replenishment via `/chips <amount>` admin command.

### Tier 4: Real-World Application Scenarios (`e2e_tier4_scenarios.test.js`)
Validates complete end-to-end player journeys:
- **Scenario 1: Complete High-Roller Journey**: VIP onboarding, placing an 8-bet layout (Straight, Split, Street, Corner, Red, Odd, Column, Dozen totaling 5,500 chips), timer countdown, spin landing on 23, winning 62,500 chips, system chat announcement, player victory chat, and round reset.
- **Scenario 2: Multi-Player Competitive Session Across 3 Full Rounds**: 3 distinct players (Alice, Bob, Charlie) competing over 3 consecutive rounds with changing strategies, bet clearing, hedged columns, and verified FIFO history accumulation `[32, 12, 7]`.
- **Scenario 3: Zero-Pocket House Sweep & Recovery**: Diverse outside bets swept by pocket 0, balance depletion, `/chips 8000` recovery, heavy wagering on 0-inside bets, hitting 0, and recovering with 55,500 chips.
- **Scenario 4: Mid-Spin Spectator Onboarding & Next-Round Transition**: Spectator connects mid-spin, receives `SPINNING` table state, gets rejected when betting mid-spin, spectates and chats, and participates in next BETTING phase.
- **Scenario 5: Disconnect Resilience & Balance Synchronization Under Table Load**: 3 active players, mid-spin disconnect of Player 2, round completes with Player 2 winning straight 14, Player 2 reconnects in next round and balance reflects exact 36,000 payout.

---

## 4. Test Harness Design (`tests/e2e/harness.js`)

The harness provides an isolated, reliable execution environment:
- **Ephemeral Port Allocation (`startTestServer`)**: Binds HTTP server and Socket.io to port 0 (`server.listen(0, '127.0.0.1')`). Guarantees zero port collisions, enabling parallel test execution.
- **Clean Lifecycle Teardown (`close`)**: Automatically stops the game engine timer, forcibly disconnects all connected sockets, and closes the HTTP server cleanly.
- **Instrumented Client Simulation (`createTestClient`)**: Wraps `socket.io-client` with typed, promise-based helpers:
  - `connect(timeoutMs)`
  - `joinTable({ id, name, avatar, color })`
  - `placeBet({ type, value, amount }, timeoutMs)`
  - `clearBets(timeoutMs)`
  - `sendChat(text)`
  - `waitFor(eventName, predicate, timeoutMs)`: Resolves with existing or future matching event.
  - `waitForNext(eventName, predicate, timeoutMs)`: Strictly resolves with a future matching event.
- **HTTP Inspector (`httpGet`)**: Performs native `fetch` requests with automatic JSON parsing.

---

## 5. How to Run the Test Suite

All tests run via standard Node commands from the project root or the `casino-multiplayer` directory:

```bash
# 1. Run Unit Tests Only
node --test casino-multiplayer/tests/unit/**/*.test.js

# 2. Run All E2E Tests (Tiers 1-4)
node --test casino-multiplayer/tests/e2e/*.test.js

# 3. Run Individual Tiers
node --test casino-multiplayer/tests/e2e/e2e_tier1_features.test.js
node --test casino-multiplayer/tests/e2e/e2e_tier2_boundaries.test.js
node --test casino-multiplayer/tests/e2e/e2e_tier3_combinations.test.js
node --test casino-multiplayer/tests/e2e/e2e_tier4_scenarios.test.js

# 4. Run Entire Combined Test Suite
node --test casino-multiplayer/tests/**/*.test.js
```
