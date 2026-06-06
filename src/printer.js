// src/printer.js
'use strict';

const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const { buildText } = require('./escpos');
const { logInfo, logError } = require('./utils');

function normalizeJobs(body) {
  if (Array.isArray(body.jobs)) return body.jobs;
  if (body.job && typeof body.job === 'object') return [body.job];
  if (body.printer_role || body.station || body.payload) return [body];
  return [];
}

function logJob(job, config) {
  if (!config.logPrintJobs) return;

  const info = {
    type: job.type || '',
    printer_role: job.printer_role || '',
    station: job.station ? {
      connection_type: job.station.connection_type,
      printer_name: job.station.printer_name,
      printer_ip: job.station.printer_ip,
      printer_port: job.station.printer_port
    } : null
  };

  console.log('[print:job]', info);
  logInfo('[print:job] ' + JSON.stringify(info));
}

function writeNetworkPrinter(buffer, station) {
  return new Promise((resolve, reject) => {
    const ip = String(station.printer_ip || '').trim();
    const port = Number(station.printer_port || 9100);

    if (!ip) {
      reject(new Error('Network printer IP is required'));
      return;
    }

    const socket = new net.Socket();
    let settled = false;

    const done = (err) => {
      if (settled) return;
      settled = true;

      try { socket.destroy(); } catch (e) {}

      if (err) reject(err);
      else resolve({ ok: true, transport: 'network', ip, port });
    };

    socket.setTimeout(7000);

    socket.on('error', done);
    socket.on('timeout', () => done(new Error(`Printer connection timed out: ${ip}:${port}`)));

    socket.connect(port, ip, () => {
      socket.write(buffer, err => {
        if (err) return done(err);
        socket.end();
        done();
      });
    });
  });
}

function runCommand(command, args, inputBuffer) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
        return;
      }

      resolve({ ok: true, stdout, stderr });
    });

    if (inputBuffer) {
      child.stdin.write(inputBuffer);
      child.stdin.end();
    }
  });
}

async function writeLocalPrinter(buffer, station) {
  const printerName = String(station.printer_name || '').trim();

  if (!printerName) {
    throw new Error('Printer name is required for USB/shared printing');
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    await runCommand('lp', ['-d', printerName, '-o', 'raw'], buffer);
    return { ok: true, transport: 'local', command: 'lp', printer_name: printerName };
  }

  if (process.platform === 'win32') {
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `deelos-print-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

    fs.writeFileSync(tmp, buffer);

    try {
      await runCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        `Get-Content -LiteralPath "${tmp.replace(/"/g, '\\"')}" | Out-Printer -Name "${printerName.replace(/"/g, '\\"')}"`
      ]);

      return { ok: true, transport: 'windows-out-printer', printer_name: printerName };
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) {}
    }
  }

  throw new Error(`Local printer transport is not supported on ${process.platform}`);
}

async function sendToPrinter(buffer, station) {
  const type = String(station.connection_type || 'usb').toLowerCase();

  if (type === 'network') {
    return writeNetworkPrinter(buffer, station);
  }

  if (type === 'usb' || type === 'shared' || type === 'bluetooth') {
    return writeLocalPrinter(buffer, station);
  }

  throw new Error(`Unsupported connection_type: ${type}`);
}

function resolveStation(job) {
  const station = job.station || {};

  return {
    station_key: station.station_key || job.station_key || job.printer_role || 'receipt',
    station_name: station.station_name || '',
    printer_role: station.printer_role || job.printer_role || 'receipt',
    connection_type: station.connection_type || job.connection_type || 'usb',
    printer_name: station.printer_name || job.printer_name || '',
    printer_ip: station.printer_ip || job.printer_ip || '',
    printer_port: station.printer_port || job.printer_port || 9100,
    paper_size: station.paper_size || job.paper_size || '80mm',
    copies: Number(station.copies || job.copies || 1)
  };
}

async function printSingleJob(job, config) {
  const station = resolveStation(job);
  const copies = Math.max(1, Number(job.copies || station.copies || 1));
  const paperSize = station.paper_size || config.defaultPaperSize || '80mm';

  const normalized = Object.assign({}, job, {
    paper_size: paperSize,
    station
  });

  const buffer = buildText(normalized);
  const results = [];

  for (let i = 0; i < copies; i++) {
    const result = await sendToPrinter(buffer, station);
    results.push(result);
  }

  return {
    ok: true,
    printer_role: station.printer_role,
    copies,
    station,
    results
  };
}

async function printJobs(body, config) {
  const jobs = normalizeJobs(body);

  if (!jobs.length) {
    return {
      ok: false,
      error: 'No print jobs received'
    };
  }

  const results = [];
  let printed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      logJob(job, config);

      const result = await printSingleJob(job, config);
      results.push(result);
      printed += Number(result.copies || 1);
    } catch (err) {
      failed++;
      const message = err && err.message ? err.message : 'Print job failed';
      logError('[print:failed] ' + message);
      results.push({
        ok: false,
        printer_role: job.printer_role || '',
        error: message
      });
    }
  }

  return {
    ok: failed === 0,
    printed,
    failed,
    results,
    message: failed === 0 ? 'Print jobs completed' : 'Some print jobs failed'
  };
}

async function testPrint(body, config) {
  const station = body.station || body;

  const job = {
    type: body.type || 'test_receipt',
    printer_role: station.printer_role || body.printer_role || 'receipt',
    copies: body.copies || station.copies || 1,
    station,
    payload: {
      business_name: body.business_name || 'DEELOS ERP',
      branch_name: body.branch_name || 'Print Agent Test',
      order_code: 'TEST-' + Date.now(),
      date: new Date().toLocaleString(),
      cashier: os.hostname(),
      customer: 'Test Print',
      items: [
        { name: 'Receipt printer test', qty: 1, total: 0.00 }
      ],
      subtotal: 0,
      tax: 0,
      total: 0,
      amount_paid: 0,
      balance: 0,
      footer: 'Print test completed'
    }
  };

  return printJobs({ jobs: [job] }, config);
}

async function listPrinters() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const result = await runCommand('lpstat', ['-p']);
      const names = String(result.stdout || '')
        .split('\n')
        .map(line => {
          const match = line.match(/^printer\s+(\S+)/i);
          return match ? match[1] : null;
        })
        .filter(Boolean);

      return names.map(name => ({ name, source: 'lpstat' }));
    } catch (err) {
      return [];
    }
  }

  if (process.platform === 'win32') {
    try {
      const result = await runCommand('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        'Get-Printer | Select-Object -ExpandProperty Name'
      ]);

      return String(result.stdout || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(name => ({ name, source: 'Get-Printer' }));
    } catch (err) {
      return [];
    }
  }

  return [];
}

module.exports = {
  printJobs,
  testPrint,
  listPrinters
};
