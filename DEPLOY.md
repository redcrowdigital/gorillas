# Self-Hosting

Gorillas is a simple Node.js app. You can self-host it on any server with Node 18+.

## Quick Start

```bash
git clone https://github.com/redcrowdigital/gorillas.git
cd gorillas
npm install
node server.js
```

Open `http://localhost:3001` in two browser windows and play.

## Production

For a production deployment behind a reverse proxy (Caddy, nginx, etc.):

```bash
# Bind to localhost only (reverse proxy handles external traffic)
HOST=127.0.0.1 node server.js
```

The server needs:
- **Port 3001** (configurable in server.js)
- **WebSocket support** in your reverse proxy
- **Node.js 18+**

Example Caddy config:

```
gorillas.example.com {
    reverse_proxy localhost:3001
}
```

Caddy handles HTTPS automatically via Let's Encrypt.

## Process Management

Use PM2 to keep the server running:

```bash
npm install -g pm2
HOST=127.0.0.1 pm2 start server.js --name gorillas
pm2 save
pm2 startup
```
