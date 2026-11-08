# Deployment Guide — Monte Carlo Royale Multiplayer Casino

This guide provides step-by-step instructions for hosting the **Monte Carlo Royale 3D Multiplayer European Roulette Casino**.

Whether you want **100% free cloud hosting** so your local PC experiences **zero CPU load and zero fan noise**, or prefer **instant local hosting on Windows** with an automated public Cloudflare Quick Tunnel, follow the appropriate section below.

---

## Deployment Options at a Glance

| Deployment Method | Cost | PC Fan / CPU Load | Setup Time | Public URL Type |
|---|---|---|---|---|
| **Render (Cloud)** | **Free** | **0% (Silent & Cool)** | ~2 mins | Persistent HTTPS (`xxx.onrender.com`) |
| **Railway (Cloud)** | Free Trial / Low Cost | **0% (Silent & Cool)** | ~2 mins | Persistent HTTPS (`xxx.up.railway.app`) |
| **Fly.io (Docker)** | Free Allowance | **0% (Silent & Cool)** | ~3 mins | Persistent HTTPS (`xxx.fly.dev`) |
| **Local + Cloudflare** | Free | Local execution | Instant | Ephemeral HTTPS (`xxx.trycloudflare.com`) |

---

## Option 1: Free 1-Click Cloud Hosting on Render (Recommended)

Render offers a 100% free web service tier with native WebSocket support. Hosting in the cloud means the server runs entirely on Render's infrastructure, keeping your local machine completely silent and cool with **0 fan noise**.

### Step-by-Step Instructions:

1. **Push your repository to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Monte Carlo Royale Casino"
   git branch -M main
   git remote add origin https://github.com/<your-username>/casino-multiplayer.git
   git push -u origin main
   ```

2. **Log into Render**:
   - Visit [https://render.com](https://render.com) and sign in (using GitHub is quickest).

3. **Deploy using the Blueprint (`render.yaml`)**:
   - In your Render dashboard, click **New +** and select **Blueprint**.
   - Connect your GitHub repository.
   - Render will automatically detect `render.yaml` in the root folder, configure the web service (`node`, `free` plan, `npm ci --omit=dev --ignore-scripts`, `npm start`), and apply the required environment variables:
     * `NODE_ENV`: `production`
     * `NODE_VERSION`: `20`
     * `ENABLE_TUNNEL`: `false`
   - Click **Apply**.

4. **Alternative: Manual Web Service Setup**:
   - In Render, click **New +** -> **Web Service**.
   - Choose **Build and deploy from a Git repository**.
   - Select runtime **Node**.
   - Build Command: `npm ci --omit=dev --ignore-scripts`
   - Start Command: `npm start`
   - Instance Type: **Free**
   - Under **Environment Variables**, set:
     * `NODE_ENV` = `production`
     * `NODE_VERSION` = `20`
     * `ENABLE_TUNNEL` = `false`
   - Click **Create Web Service**.

5. **Access Your Casino**:
   - Within 1-2 minutes, Render builds the application and assigns you a public URL (e.g. `https://casino-multiplayer.onrender.com`).
   - Share this link with any remote players. They can open it on their phones, tablets, or computers and play live multiplayer roulette in real time!

---

## Option 2: Instant Cloud Hosting on Railway

Railway supports instant Git deployments and automatically parses our included `Procfile` or `Dockerfile`.

### Step-by-Step Instructions:

1. Go to [https://railway.app](https://railway.app) and log in.
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select your repository.
4. Railway will automatically detect the `Procfile` (`web: npm start`) or `Dockerfile`.
5. Under project **Variables**, set:
   * `NODE_ENV`: `production`
   * `ENABLE_TUNNEL`: `false`
6. Under **Settings** -> **Networking**, click **Generate Domain**.
7. Your live URL (e.g. `https://casino-multiplayer.up.railway.app`) is active immediately with full WebSocket support!

---

## Option 3: Containerized Deployment via Fly.io

Fly.io runs applications globally close to your players using lightweight Firecracker microVMs.

### Step-by-Step Instructions:

1. Install the `flyctl` CLI:
   - Windows (PowerShell): `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`
   - macOS / Linux: `curl -L https://fly.io/install.sh | sh`
2. Sign in:
   ```bash
   fly auth login
   ```
3. Initialize the app from the `casino-multiplayer` directory:
   ```bash
   fly launch
   ```
   - Fly will detect the `Dockerfile`.
   - Accept the defaults or choose your preferred region (e.g. Frankfurt, Amsterdam, Virginia).
4. Deploy:
   ```bash
   fly deploy
   ```
5. Your casino is live on `https://<app-name>.fly.dev`!

---

## Option 4: Local Windows Hosting with Automated Cloudflare Quick Tunnel

If you prefer to host directly from your Windows PC without registering for cloud accounts, the application includes an **Automated Cloudflare Quick Tunnel**.

When started locally, the server spawns `cloudflared`, opens an encrypted public tunnel, and prints a shareable HTTPS URL in your terminal. Remote players can connect from anywhere in the world without any port forwarding or VPNs.

### Prerequisites:
- Node.js (version 18 or higher)
- NPM

### Step-by-Step Instructions:

1. **Install Dependencies**:
   Open PowerShell in the project directory:
   ```powershell
   cd c:\Users\renzo\Desktop\AGENT\casino-multiplayer
   npm install
   ```

2. **Start the Casino**:
   ```powershell
   npm start
   ```

3. **Observe the Console Banner**:
   On startup, you will see the luxury casino banner output in your terminal:

   ```
   ========================================================================
     💎 MONTE CARLO ROYALE — LUXURY MULTIPLAYER CASINO 💎
     Live European Roulette (Single-Zero 37 Pockets) • 100% Silent Mode
   ========================================================================
     ★ PUBLIC HTTPS TUNNEL ACCESS (Share with remote players):
       >>> https://crystal-velvet-roulette.trycloudflare.com <<<

     ♦ Local Server:  http://127.0.0.1:3000
     ♠ Protocol:      HTTPS & WSS Secure WebSocket Connection
     ♥ Requirements:  Zero Install • Any Desktop or Mobile Browser
     ♣ Network:       Cloudflare Global Edge Network Active
   ========================================================================
   ```

4. **Connect & Share**:
   - Open `http://localhost:3000` in your browser.
   - Copy the public `https://<subdomain>.trycloudflare.com` URL and send it to friends or remote players.
   - Everyone joins the same table, places bets, chats, and watches the 3D wheel spin synchronized in real time!

5. **Stopping the Server**:
   - Press `Ctrl + C` in PowerShell.
   - The server shuts down cleanly and automatically terminates the child `cloudflared` tunnel process.

---

## Environment Configuration Reference

The application can be customized through environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP and WebSocket server. |
| `HOST` | `0.0.0.0` | Network interface to bind to (`0.0.0.0` binds to all interfaces). |
| `NODE_ENV` | `development` | Environment mode (`production` disables dev logs). |
| `ENABLE_TUNNEL` | `true` (locally) | Set to `false` to disable the Cloudflare Quick Tunnel (automatically disabled when cloud hosting is detected). |
| `CLOUDFLARED_PATH` | (auto-detected) | Path to a custom `cloudflared` executable if not using the bundled binary. |
| `RENDER` | (set by Render) | Automatically detected; bypasses local Cloudflare tunnel. |
| `RAILWAY_ENVIRONMENT` | (set by Railway) | Automatically detected; bypasses local Cloudflare tunnel. |

---

## Troubleshooting & FAQ

### Q: Why host on Render instead of locally?
Hosting on Render offloads all CPU, GPU, and network computation to the cloud. Your local machine will experience **zero fan noise**, zero heat generation, and the server stays online 24/7 even if you turn off your PC.

### Q: Are WebSockets supported over Cloudflare Quick Tunnels?
Yes. Cloudflare Quick Tunnels support WebSocket connections (`wss://`) natively, allowing the real-time betting board and synchronized wheel spins to work flawlessly.

### Q: Does the Cloudflare tunnel URL change?
Yes. The free Quick Tunnel generates a new random subdomain each time you restart the local server. For a permanent URL, deploy to Render or Railway as described above.

### Q: How do I disable the tunnel when testing locally?
Set `ENABLE_TUNNEL=false`:
```powershell
$env:ENABLE_TUNNEL="false"; npm start
```
