#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');

// ---------- Config (env vars) ----------
const PORT        = Number(process.env.PORT || 3000);
const TARGET      = process.env.TARGET || 'https://httpbin.org';
const FAIL_RATE   = Number(process.env.FAIL_RATE ?? 0.2);  // 0..1, e.g. 0.2 = 20%
const FAIL_STATUS = Number(process.env.FAIL_STATUS || 500);

const target   = new URL(TARGET);
const basePath = target.pathname.replace(/\/+$/, '');      // supports https://api.x.com/v1
const targetPort = target.port || (target.protocol === 'https:' ? 443 : 80);
const transport  = target.protocol === 'https:' ? https : http;

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Proxy ----------
const server = http.createServer((req, res) => {
  const id = Math.random().toString(36).slice(2, 8);

  // 1) Random simulated upstream failure
  if (Math.random() < FAIL_RATE) {
    log(`[${id}] ${req.method} ${req.url} -> ${FAIL_STATUS} (simulated)`);
    res.writeHead(FAIL_STATUS, {
      'Content-Type': 'application/json',
      'Connection': 'close',
    });
    res.end(JSON.stringify({ error: 'Simulated proxy failure', requestId: id }));
    req.resume(); // drain any request body so the socket isn't corrupted
    return;
  }

  // 2) Build upstream path (keeps query string, prepends target base path)
  const incoming     = new URL(req.url, 'http://localhost');
  const upstreamPath = basePath + incoming.pathname + incoming.search;

  // 3) Copy request headers, rewrite Host, drop hop-by-hop
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(k)) continue;
    headers[k] = v;
  }
  headers.host = target.host;

  log(`[${id}] ${req.method} ${req.url} -> ${target.origin}${upstreamPath}`);

  const proxyReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: targetPort,
      method: req.method,
      path: upstreamPath,
      headers,
    },
    (proxyRes) => {
      // 4) Copy response headers, drop hop-by-hop
      const resHeaders = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (HOP_BY_HOP.has(k)) continue;
        resHeaders[k] = v;
      }
      res.writeHead(proxyRes.statusCode || 502, resHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    log(`[${id}] upstream error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Connection': 'close' });
      res.end(JSON.stringify({ error: 'Bad gateway', message: err.message, requestId: id }));
    } else {
      res.destroy(err);
    }
  });

  // Abort upstream if the client disconnects
  req.on('close', () => proxyReq.destroy());

  // 5) Stream the request body as-is
  req.pipe(proxyReq);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Proxy listening on http://127.0.0.1:${PORT}`);
  log(`Forwarding to ${TARGET}  (fail rate: ${(FAIL_RATE * 100).toFixed(1)}%)`);
});
