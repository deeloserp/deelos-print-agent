// src/utils.js
'use strict';

const fs = require('fs');
const path = require('path');

function appRoot() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }

  return path.resolve(__dirname, '..');
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
}

function logDir() {
  const dir = path.join(appRoot(), 'logs');
  ensureDir(dir);
  return dir;
}

function logLine(level, message) {
  const line = `[${new Date().toISOString()}] ${level} ${message}\n`;
  try {
    fs.appendFileSync(path.join(logDir(), 'agent.log'), line, 'utf8');
  } catch (e) {}
}

function logInfo(message) {
  logLine('INFO', message);
}

function logError(message) {
  logLine('ERROR', message);
}

function loadConfig() {
  const root = appRoot();
  const configPath = path.join(root, 'config.json');

  const defaults = {
    agentName: 'Deelos Print Agent',
    version: '1.0.0',
    host: '127.0.0.1',
    port: 4789,
    allowOrigin: '*',
    defaultPaperSize: '80mm',
    logPrintJobs: true,
    maxBodyBytes: 1048576
  };

  try {
    if (!fs.existsSync(configPath)) {
      try {
        fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf8');
      } catch (e) {}
      return defaults;
    }

    const raw = fs.readFileSync(configPath, 'utf8');
    const data = JSON.parse(raw);

    return Object.assign({}, defaults, data || {});
  } catch (err) {
    logError('[agent:config] Failed to read config.json. Using defaults. ' + err.message);
    return defaults;
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json)
  });
  res.end(json);
}

function readJsonBody(req, maxBytes) {
  maxBytes = Number(maxBytes || 1048576);

  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;

      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function notFound(res) {
  return sendJson(res, 404, {
    ok: false,
    error: 'Endpoint not found'
  });
}

function methodNotAllowed(res) {
  return sendJson(res, 405, {
    ok: false,
    error: 'Method not allowed'
  });
}

module.exports = {
  appRoot,
  loadConfig,
  sendJson,
  readJsonBody,
  notFound,
  methodNotAllowed,
  logInfo,
  logError
};
