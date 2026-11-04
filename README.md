# Monte Carlo Royale — Modern 3D Multiplayer European Roulette Casino

A modern, stylish, and high-performance **3D Multiplayer European Roulette** casino web application. Built with lightweight procedural Three.js graphics, a server-authoritative single-zero game engine, synchronized real-time WebSocket state, automated Cloudflare Quick Tunnels, and 1-click cloud deployment.

---

## Key Features

### 1. Prestige Luxury Casino Aesthetic
- **Zero GTA Branding**: Pure, sophisticated Monte Carlo velvet & gold theme.
- **Glassmorphic UI**: High-contrast gold accents, emerald green felt, and polished dark slate surfaces.
- **Live Event Feed**: Integrated multiplayer chat with system notices for player joins, leaves, winning numbers, and chip payouts.

### 2. Lightweight 3D Graphics & Silent Performance
- **Low-Poly Procedural Wheel**: Procedurally generated Three.js geometry with under 4,000 polygons and zero external 3D model asset downloads.
- **Dynamic 2D Pocket Atlas**: 37 pockets rendered on a single dynamic 2D canvas texture with fewer than 6 draw calls.
- **Dual-Rate Thermal Throttling**: Smooth 60 FPS during ball spins, automatically throttled to 30 FPS when idle to prevent GPU/CPU strain and keep devices cool.
- **100% Silent Design ("geen audio")**: Complete absence of sound synthesis, audio files, and audio contexts for zero audio memory overhead.

### 3. Synchronized Multiplayer Roulette Engine
- **Standard European Single-Zero Rules**:
  * 37 numbered pockets ($0$ to $36$) in authentic clockwise layout: `[0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]`.
  * Exactly $2.7027\%$ house edge across all bet types ($97.297\%$ expected return).
- **Comprehensive Betting Board**:
  * **Inside Bets**: Straight (35:1), Split (17:1), Street (11:1), Corner (8:1), Six Line (5:1).
  * **Outside Bets**: Dozens (2:1), Columns (2:1), Even/Odd (1:1), Red/Black (1:1), Low/High (1:1).
- **Authoritative 3-Phase State Machine**:
  * `BETTING` ($20$s): Chip wagering, placement broadcasts, clearing allowed.
  * `SPINNING` ($9$s): Betting closed, deterministic ball animation, pocket landing.
  * `PAYOUT` ($6$s): Server calculates payouts, updates atomic chip ledgers, announces winners.

### 4. Player Onboarding & Social Interaction
- **Instant Browser Access**: Choose a display name and custom avatar badge color.
- **10,000 Chip Starting Bankroll**: Stored in server memory with atomic ledger balance deductions and credits.
- **Real-Time Multiplayer Chat**: Instant room messaging with HTML sanitization to prevent script injection.

### 5. Automated Cloudflare Quick Tunnel
- Spawns a secure `cloudflared` tunnel on local startup, exposing the local server to the internet via an ephemeral `trycloudflare.com` URL.
- Zero firewall configuration or port forwarding required — share the link and play immediately.

### 6. 1-Click Cloud Hosting (0% Local PC Load)
- **Render Blueprint (`render.yaml`)**: Free 1-click cloud deployment with native WebSocket support.
- **Railway / Heroku (`Procfile`)**: Seamless containerized deployment.
- **Production Dockerfile**: Lightweight `node:20-alpine` container.
- See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

---

## Project Structure

```
casino-multiplayer/
├── Dockerfile                    # Production container image (node:20-alpine)
├── render.yaml                   # 1-click Render blueprint
├── Procfile                      # Railway & Heroku process definition
├── .dockerignore                 # Docker build exclusions
├── package.json                  # Dependencies, test scripts, engines
├── README.md                     # High-level architecture and guide
├── DEPLOYMENT.md                 # Complete cloud and local deployment guide
├── TEST_INFRA.md                 # Testing specification and methodology
│
├── server/
│   ├── index.js                  # Entry point (Express + Socket.io + Tunnel launcher)
│   ├── app.js                    # Express app configuration & static file serving
│   ├── socket.js                 # Typed Socket.io event handling & room management
│   ├── tunnel.js                 # Automated Cloudflare Quick Tunnel manager
│   └── game/
│       ├── rouletteConstants.js  # Wheel pocket sequence, colors, payouts, bet types
│       ├── rouletteMath.js       # Pure betting evaluation & payout calculation engine
│       ├── rouletteEngine.js     # State machine (BETTING -> SPINNING -> PAYOUT)
│       └── playerManager.js      # Player sessions, bankroll ledgers, validation
│
├── client/
│   ├── index.html                # Modern single-page casino UI
│   ├── css/
│   │   ├── style.css             # Emerald & gold luxury theme, glassmorphic HUD
│   │   └── layout.css            # Responsive layout & betting table grid
│   └── js/
│       ├── app.js                # Client bootstrap & coordination
│       ├── network.js            # Socket.io client wrapper & sync
│       ├── ui.js                 # DOM interactions, chips HUD, betting board, chat
│       └── three/
│           ├── scene.js          # Three.js 60fps/30fps rendering loop
│           └── rouletteWheel.js  # Low-poly 3D wheel & ball physics trajectory
│
└── tests/
    ├── unit/                     # Unit test suites (math, engine, player, defense)
    ├── integration/              # Socket.io lifecycle integration tests
    └── e2e/                      # 4-tier requirement-driven opaque-box E2E suite
```

---

## Quickstart Guide

### 1. Local Development on Windows

```powershell
# Navigate into the project directory
cd c:\Users\renzo\Desktop\AGENT\casino-multiplayer

# Install dependencies
npm install

# Start the server (automatically launches Cloudflare Tunnel on Windows)
npm start
```

Upon startup, the console displays your local server link and the public Cloudflare tunnel:
```
========================================================================
  💎 MONTE CARLO ROYALE — LUXURY MULTIPLAYER CASINO 💎
  Live European Roulette (Single-Zero 37 Pockets) • 100% Silent Mode
========================================================================
  ★ PUBLIC HTTPS TUNNEL ACCESS (Share with remote players):
    >>> https://example-subdomain.trycloudflare.com <<<

  ♦ Local Server:  http://127.0.0.1:3000
  ♠ Protocol:      HTTPS & WSS Secure WebSocket Connection
  ♥ Requirements:  Zero Install • Any Desktop or Mobile Browser
  ♣ Network:       Cloudflare Global Edge Network Active
========================================================================
```

Open `http://localhost:3000` in your browser, or share the `trycloudflare.com` URL with remote players.

### 2. Cloud Deployment (Render / Railway / Docker)

For 24/7 cloud hosting with **zero PC fan noise and zero local CPU load**, follow the detailed steps in [DEPLOYMENT.md](DEPLOYMENT.md).

Quick Render Deployment:
1. Push to your GitHub account.
2. In [Render](https://render.com), create a **New Blueprint** and select the repository.
3. Render automatically provisions the web service using `render.yaml`.

---

## Automated Verification Suite

The repository includes a comprehensive test suite covering mathematical proofs, state transitions, adversarial edge cases, and end-to-end player journeys.

```powershell
# Run the complete test suite
npm test
```

### Verification Coverage:
- **Unit Layer**: Payout ratios for all bet types, 2.7027% house edge invariance, 60 physical splits, 23 corners, player bankroll atomic ledger.
- **Integration Layer**: Socket.io event lifecycle, cross-origin support, trust proxy verification.
- **4-Tier E2E Layer**:
  * Tier 1: Feature coverage (HTTP delivery, onboarding, betting, clearing, chat, state machine, disconnection).
  * Tier 2: Boundary & corner cases (financial limits, coordinate boundaries, zero pocket sweep, XSS input defense).
  * Tier 3: Cross-feature combinations (multi-player concurrency, interleaved chat and bets, table clearing).
  * Tier 4: Real-world scenarios (high-roller journey, competitive 3-round sessions, zero sweep recovery).
