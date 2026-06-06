#!/usr/bin/env node
'use strict';

const http = require('http');
const os = require('os');
const { URL } = require('url');
const { loadConfig, sendJson, readJsonBody, notFound, methodNotAllowed, logInfo, logError } = require('./utils');
const { printJobs, testPrint, listPrinters } = require('./printer');

const config = loadConfig();

function setCors(req, res) {
  const origin = req.headers.origin || '*';
  const allowed = config.allowOrigin || '*';

  res.setHeader('Access-Control-Allow-Origin', allowed === '*' ? origin : allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Deelos-Agent-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function router(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  try {
    if (url.pathname === '/health') {
      if (req.method !== 'GET') return methodNotAllowed(res);

      return sendJson(res, 200, {
        ok: true,
        agent: config.agentName,
        version: config.version,
        host: config.host,
        port: config.port,
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        uptime_seconds: Math.floor(process.uptime()),
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/printers') {
      if (req.method !== 'GET') return methodNotAllowed(res);

      const printers = await listPrinters();

      return sendJson(res, 200, {
        ok: true,
        printers
      });
    }

    if (url.pathname === '/test-print') {
      if (req.method !== 'POST') return methodNotAllowed(res);

      const body = await readJsonBody(req, config.maxBodyBytes);
      const result = await testPrint(body || {}, config);

      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/print') {
      if (req.method !== 'POST') return methodNotAllowed(res);

      const body = await readJsonBody(req, config.maxBodyBytes);
      const result = await printJobs(body || {}, config);

      return sendJson(res, result.ok ? 200 : 400, result);
    }

    return notFound(res);
  } catch (err) {
    logError('[agent:error] ' + (err && err.stack ? err.stack : err));

    return sendJson(res, 500, {
      ok: false,
      error: err && err.message ? err.message : 'Unexpected print agent error'
    });
  }
}

const server = http.createServer(router);

server.listen(config.port, config.host, () => {
  const msg = `${config.agentName} ${config.version} running on http://${config.host}:${config.port}`;
  console.log(msg);
  logInfo(msg);
  console.log(`Health: http://${config.host}:${config.port}/health`);
});

function shutdown() {
  logInfo('Stopping Deelos Print Agent');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logError('[uncaughtException] ' + (err && err.stack ? err.stack : err));
});

process.on('unhandledRejection', (err) => {
  logError('[unhandledRejection] ' + (err && err.stack ? err.stack : err));
});
