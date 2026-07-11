// src/printer.js
'use strict';

const net = require('net');
const os = require('os');
const { execFile } = require('child_process');
const { buildText } = require('./escpos');
const { logInfo, logError } = require('./utils');


const WINDOWS_RAW_HELPER_VERSION = '2026-07-11-v1';

const WINDOWS_RAW_HELPER_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,

  [Parameter(Mandatory = $true)]
  [string]$FilePath,

  [string]$DocumentName = 'Deelos Receipt'
)

$ErrorActionPreference = 'Stop'

$source = @"
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

namespace Deelos.Printing
{
    public static class RawPrinter
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private class DOC_INFO_1
        {
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDocName;

            [MarshalAs(UnmanagedType.LPWStr)]
            public string pOutputFile;

            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDataType;
        }

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr defaults);

        [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern int StartDocPrinter(IntPtr printerHandle, int level, [In] DOC_INFO_1 docInfo);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool StartPagePrinter(IntPtr printerHandle);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool WritePrinter(IntPtr printerHandle, IntPtr bytes, int count, out int written);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool EndPagePrinter(IntPtr printerHandle);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool EndDocPrinter(IntPtr printerHandle);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool ClosePrinter(IntPtr printerHandle);

        private static void ThrowLastError(string action)
        {
            int errorCode = Marshal.GetLastWin32Error();
            throw new Win32Exception(errorCode, action + " failed with Windows error " + errorCode + ".");
        }

        public static int SendFile(string printerName, string filePath, string documentName)
        {
            if (String.IsNullOrWhiteSpace(printerName))
                throw new ArgumentException("Printer name is required.", "printerName");

            if (String.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
                throw new FileNotFoundException("The RAW print file was not found.", filePath);

            byte[] data = File.ReadAllBytes(filePath);
            IntPtr printerHandle = IntPtr.Zero;
            IntPtr unmanagedData = IntPtr.Zero;
            bool documentStarted = false;
            bool pageStarted = false;
            int jobId = 0;

            if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero))
                ThrowLastError("OpenPrinter");

            try
            {
                DOC_INFO_1 docInfo = new DOC_INFO_1
                {
                    pDocName = String.IsNullOrWhiteSpace(documentName) ? "Deelos Receipt" : documentName,
                    pOutputFile = null,
                    pDataType = "RAW"
                };

                jobId = StartDocPrinter(printerHandle, 1, docInfo);
                if (jobId == 0)
                    ThrowLastError("StartDocPrinter");

                documentStarted = true;

                if (!StartPagePrinter(printerHandle))
                    ThrowLastError("StartPagePrinter");

                pageStarted = true;

                if (data.Length > 0)
                {
                    unmanagedData = Marshal.AllocHGlobal(data.Length);
                    Marshal.Copy(data, 0, unmanagedData, data.Length);

                    int written;
                    if (!WritePrinter(printerHandle, unmanagedData, data.Length, out written))
                        ThrowLastError("WritePrinter");

                    if (written != data.Length)
                    {
                        throw new IOException(
                            "Windows accepted only " + written + " of " + data.Length + " RAW print bytes."
                        );
                    }
                }

                return jobId;
            }
            finally
            {
                if (unmanagedData != IntPtr.Zero)
                    Marshal.FreeHGlobal(unmanagedData);

                if (pageStarted)
                    EndPagePrinter(printerHandle);

                if (documentStarted)
                    EndDocPrinter(printerHandle);

                if (printerHandle != IntPtr.Zero)
                    ClosePrinter(printerHandle);
            }
        }
    }
}
"@

try {
  Add-Type -TypeDefinition $source -Language CSharp
  $jobId = [Deelos.Printing.RawPrinter]::SendFile($PrinterName, $FilePath, $DocumentName)
  Write-Output ("RAW print job submitted. Job ID: " + $jobId)
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;

function ensureWindowsRawPrintHelper() {
  const fs = require('fs');
  const path = require('path');
  const helperPath = path.join(
    os.tmpdir(),
    `deelos-raw-print-helper-${WINDOWS_RAW_HELPER_VERSION}.ps1`
  );

  let current = '';

  try {
    current = fs.readFileSync(helperPath, 'utf8');
  } catch (e) {}

  if (current !== WINDOWS_RAW_HELPER_SCRIPT) {
    fs.writeFileSync(helperPath, WINDOWS_RAW_HELPER_SCRIPT, 'utf8');
  }

  return helperPath;
}

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
    const tmp = path.join(
      os.tmpdir(),
      `deelos-print-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`
    );
    const helperPath = ensureWindowsRawPrintHelper();
    const documentName = `Deelos ${String(station.printer_role || 'receipt')} ${new Date().toISOString()}`;

    fs.writeFileSync(tmp, buffer);

    try {
      const result = await runCommand('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', helperPath,
        '-PrinterName', printerName,
        '-FilePath', tmp,
        '-DocumentName', documentName
      ]);

      return {
        ok: true,
        transport: 'windows-raw-spooler',
        printer_name: printerName,
        message: String(result.stdout || '').trim()
      };
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
      business_phone: body.business_phone || 'Test phone',
      business_email: body.business_email || 'support@deeloserp.com',
      business_website: body.business_website || 'www.deeloserp.com',
      branch_name: body.branch_name || 'Print Agent Test',
      order_code: 'TEST-' + Date.now(),
      date: new Date().toLocaleString(),
      cashier: os.hostname(),
      server: os.hostname(),
      customer_name: 'Test Customer',
      customer_phone: '0000000000',
      table: 'T1',
      mode: 'DINE-IN',
      items: [
        { name: 'Receipt printer test', qty: 1, total: 0.00 }
      ],
      subtotal: 0,
      discount: 0,
      tax_lines: [
        { tax_name: 'NHIL', tax_rate: 2.5, amount: 0 },
        { tax_name: 'TOURISM LEVY', tax_rate: 0, amount: 0 },
        { tax_name: 'VAT', tax_rate: 0, amount: 0 }
      ],
      delivery: 0,
      total: 0,
      net_total: 0,
      amount_paid: 0,
      balance: 0,
      tracking_url: 'https://deeloserp.com',
      qr_text: 'https://deeloserp.com',
      footer: 'THANK YOU.',
      powered_by: 'POWERED BY DEELOS ERP'
    }
  };

  return printJobs({ jobs: [job] }, config);
}

function parsePrinterUri(uri) {
  uri = String(uri || '').trim();

  const info = {
    uri,
    connection_type: '',
    ip: '',
    host: '',
    port: null
  };

  if (!uri) return info;

  if (/^(socket|tcp):\/\//i.test(uri)) {
    info.connection_type = 'network';
    const match = uri.match(/^(?:socket|tcp):\/\/([^/:\s]+)(?::(\d+))?/i);
    if (match) {
      info.host = match[1] || '';
      info.ip = match[1] || '';
      info.port = match[2] ? Number(match[2]) : 9100;
    }
    return info;
  }

  if (/^(ipp|ipps|lpd|http|https):\/\//i.test(uri)) {
    info.connection_type = 'network';
    try {
      const u = new URL(uri);
      info.host = u.hostname || '';
      info.ip = u.hostname || '';
      info.port = u.port ? Number(u.port) : null;
    } catch (e) {}
    return info;
  }

  if (/^(usb|dnssd|mdns):/i.test(uri)) {
    info.connection_type = 'usb';
    return info;
  }

  return info;
}

function parseLpstatPrinters(printerStdout, uriStdout) {
  const printers = String(printerStdout || '')
    .split('\n')
    .map(line => {
      const match = line.match(/^printer\s+(\S+)/i);
      return match ? match[1] : null;
    })
    .filter(Boolean);

  const uriMap = {};
  String(uriStdout || '')
    .split('\n')
    .forEach(line => {
      const match = line.match(/^device\s+for\s+(\S+):\s+(.+)$/i);
      if (match) uriMap[match[1]] = match[2].trim();
    });

  return printers.map(name => {
    const uri = uriMap[name] || '';
    const parsed = parsePrinterUri(uri);

    return {
      name,
      source: 'lpstat',
      connection_type: parsed.connection_type || '',
      uri: parsed.uri || '',
      ip: parsed.ip || '',
      host: parsed.host || '',
      port: parsed.port || null
    };
  });
}

async function listPrinters() {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    try {
      const printersResult = await runCommand('lpstat', ['-p']);
      let uriStdout = '';

      try {
        const uriResult = await runCommand('lpstat', ['-v']);
        uriStdout = uriResult.stdout || '';
      } catch (e) {
        uriStdout = '';
      }

      return parseLpstatPrinters(printersResult.stdout || '', uriStdout);
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
        '$ports = Get-PrinterPort | Select-Object Name,PrinterHostAddress,PortNumber; ' +
        '$printers = Get-Printer | Select-Object Name,PortName,DriverName,Shared; ' +
        '$rows = foreach ($p in $printers) { ' +
        '  $port = $ports | Where-Object { $_.Name -eq $p.PortName } | Select-Object -First 1; ' +
        '  [PSCustomObject]@{ Name=$p.Name; PortName=$p.PortName; DriverName=$p.DriverName; Shared=$p.Shared; PrinterHostAddress=$port.PrinterHostAddress; PortNumber=$port.PortNumber } ' +
        '}; ' +
        '$rows | ConvertTo-Json -Depth 4'
      ]);

      const raw = String(result.stdout || '').trim();
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : [parsed];

      return rows
        .filter(row => row && row.Name)
        .map(row => ({
          name: String(row.Name || ''),
          source: 'Get-Printer',
          connection_type: row.PrinterHostAddress ? 'network' : '',
          port_name: String(row.PortName || ''),
          driver_name: String(row.DriverName || ''),
          shared: !!row.Shared,
          ip: row.PrinterHostAddress ? String(row.PrinterHostAddress || '') : '',
          host: row.PrinterHostAddress ? String(row.PrinterHostAddress || '') : '',
          port: row.PortNumber ? Number(row.PortNumber) : null
        }));
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
