const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns').promises;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default domains to initialize frontend if local storage is empty
const defaultDomains = [
  { domain: 'xlnt.my.id', name: 'Main Site', type: 'root' },
  { domain: 'eldorian.xlnt.my.id', name: 'Eldorian Subdomain', type: 'subdomain' }
];

// Function to measure connection times and HTTP/SSL info
function checkStatus(domain) {
  return new Promise((resolve) => {
    const isHttps = true;
    const protocol = isHttps ? 'https:' : 'http:';
    const port = isHttps ? 443 : 80;
    const url = `${protocol}//${domain}`;

    const startTime = process.hrtime();
    let timings = {
      dns: null,
      tcp: null,
      tls: null,
      ttfb: null,
      total: null
    };

    let resolvedIP = null;
    let dnsStart = process.hrtime();
    let connectStart = null;
    let secureConnectStart = null;

    const opt = {
      host: domain,
      port: port,
      method: 'GET',
      path: '/',
      timeout: 10000,
      headers: {
        'User-Agent': 'XLNT-MNTR/1.0',
        'Accept': '*/*'
      }
    };

    const client = isHttps ? https : http;

    const req = client.request(opt, (res) => {
      const ttfbDiff = process.hrtime(secureConnectStart || connectStart || dnsStart);
      timings.ttfb = Math.round(ttfbDiff[0] * 1000 + ttfbDiff[1] / 1000000);

      // Extract SSL details immediately while the response socket is active
      let sslInfo = null;
      if (isHttps && res.socket && res.socket.getPeerCertificate) {
        const cert = res.socket.getPeerCertificate(true);
        if (cert && Object.keys(cert).length > 0) {
          sslInfo = {
            issuer: cert.issuer.O || cert.issuer.CN || 'Unknown',
            validFrom: cert.valid_from,
            validTo: cert.valid_to,
            daysRemaining: Math.round((new Date(cert.valid_to) - new Date()) / (1000 * 60 * 60 * 24))
          };
        }
      }

      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const totalDiff = process.hrtime(startTime);
        timings.total = Math.round(totalDiff[0] * 1000 + totalDiff[1] / 1000000);

        resolve({
          domain,
          status: 'online',
          statusCode: res.statusCode,
          server: res.headers.server || 'Unknown',
          ip: resolvedIP,
          timings,
          ssl: sslInfo,
          size: Buffer.byteLength(body),
          contentType: res.headers['content-type'] || 'Unknown'
        });
      });
    });

    req.on('socket', (socket) => {
      socket.on('lookup', (err, address) => {
        if (err) return;
        resolvedIP = address;
        const dnsDiff = process.hrtime(dnsStart);
        timings.dns = Math.round(dnsDiff[0] * 1000 + dnsDiff[1] / 1000000);
        connectStart = process.hrtime();
      });

      socket.on('connect', () => {
        const tcpDiff = process.hrtime(connectStart || dnsStart);
        timings.tcp = Math.round(tcpDiff[0] * 1000 + tcpDiff[1] / 1000000);
        secureConnectStart = process.hrtime();
      });

      socket.on('secureConnect', () => {
        const tlsDiff = process.hrtime(secureConnectStart || connectStart || dnsStart);
        timings.tls = Math.round(tlsDiff[0] * 1000 + tlsDiff[1] / 1000000);
      });
    });

    req.on('error', (err) => {
      if (isHttps) {
        checkStatusHttpFallback(domain, startTime).then(resolve);
      } else {
        resolve({
          domain,
          status: 'offline',
          error: err.message,
          ip: resolvedIP
        });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        domain,
        status: 'offline',
        error: 'Connection timeout',
        ip: resolvedIP
      });
    });

    req.end();
  });
}

// HTTP Fallback helper
function checkStatusHttpFallback(domain, startTime) {
  return new Promise((resolve) => {
    let timings = {
      dns: null,
      tcp: null,
      tls: null,
      ttfb: null,
      total: null
    };

    let resolvedIP = null;
    let dnsStart = process.hrtime();
    let connectStart = null;

    const opt = {
      host: domain,
      port: 80,
      method: 'GET',
      path: '/',
      timeout: 8000,
      headers: {
        'User-Agent': 'XLNT-MNTR/1.0'
      }
    };

    const req = http.request(opt, (res) => {
      const ttfbDiff = process.hrtime(connectStart || dnsStart);
      timings.ttfb = Math.round(ttfbDiff[0] * 1000 + ttfbDiff[1] / 1000000);

      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const totalDiff = process.hrtime(startTime);
        timings.total = Math.round(totalDiff[0] * 1000 + totalDiff[1] / 1000000);

        resolve({
          domain,
          status: 'online',
          statusCode: res.statusCode,
          server: res.headers.server || 'Unknown',
          ip: resolvedIP,
          timings,
          ssl: null,
          size: Buffer.byteLength(body),
          contentType: res.headers['content-type'] || 'Unknown'
        });
      });
    });

    req.on('socket', (socket) => {
      socket.on('lookup', (err, address) => {
        if (err) return;
        resolvedIP = address;
        const dnsDiff = process.hrtime(dnsStart);
        timings.dns = Math.round(dnsDiff[0] * 1000 + dnsDiff[1] / 1000000);
        connectStart = process.hrtime();
      });

      socket.on('connect', () => {
        const tcpDiff = process.hrtime(connectStart || dnsStart);
        timings.tcp = Math.round(tcpDiff[0] * 1000 + tcpDiff[1] / 1000000);
      });
    });

    req.on('error', (err) => {
      resolve({
        domain,
        status: 'offline',
        error: err.message,
        ip: resolvedIP
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        domain,
        status: 'offline',
        error: 'Connection timeout',
        ip: resolvedIP
      });
    });

    req.end();
  });
}

// Function to resolve DNS records
async function getDNSRecords(domain) {
  const records = {
    A: [],
    AAAA: [],
    CNAME: null,
    MX: [],
    TXT: []
  };

  try {
    const a = await dns.resolve4(domain).catch(() => []);
    records.A = a;
  } catch (e) {}

  try {
    const aaaa = await dns.resolve6(domain).catch(() => []);
    records.AAAA = aaaa;
  } catch (e) {}

  try {
    const cname = await dns.resolveCname(domain).catch(() => null);
    records.CNAME = cname;
  } catch (e) {}

  try {
    const mx = await dns.resolveMx(domain).catch(() => []);
    records.MX = mx.map(m => `${m.exchange} (Priority: ${m.priority})`);
  } catch (e) {}

  try {
    const txt = await dns.resolveTxt(domain).catch(() => []);
    records.TXT = txt.map(t => t.join(' '));
  } catch (e) {}

  return records;
}

// API Routes

// Get default monitored domains (read-only for initialization)
app.get('/api/domains', (req, res) => {
  res.json(defaultDomains);
});

// Get status for a single domain
app.get('/api/status/:domain', async (req, res) => {
  const domain = req.params.domain.toLowerCase();
  try {
    const statusPromise = checkStatus(domain);
    const dnsPromise = getDNSRecords(domain);
    
    const [statusData, dnsData] = await Promise.all([statusPromise, dnsPromise]);
    res.json({ ...statusData, dns: dnsData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Scan for active subdomains dynamically
app.post('/api/scan', async (req, res) => {
  const commonSubs = ['www', 'api', 'app', 'dev', 'test', 'git', 'mail', 'status', 'eldorian', 'admin', 'blog', 'shop'];
  const found = [];
  
  await Promise.all(
    commonSubs.map(async (sub) => {
      const subDomain = `${sub}.xlnt.my.id`;
      try {
        const ips = await dns.resolve4(subDomain);
        if (ips && ips.length > 0) {
          found.push({
            domain: subDomain,
            name: sub.charAt(0).toUpperCase() + sub.slice(1),
            type: 'subdomain'
          });
        }
      } catch (err) {
        // Did not resolve, ignore
      }
    })
  );

  // Add root if active
  try {
    const ips = await dns.resolve4('xlnt.my.id');
    if (ips && ips.length > 0) {
      found.unshift({
        domain: 'xlnt.my.id',
        name: 'Main Site',
        type: 'root'
      });
    }
  } catch (err) {}

  res.json({
    message: `Scan complete. Found ${found.length} active domains.`,
    found: found
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`XLNT MNTR. Server is running on port ${PORT}`);
  });
}

module.exports = app;
