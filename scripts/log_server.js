const http = require('http');
const fs = require('fs');
const path = require('path');

const logFile = path.resolve(__dirname, '../ghostfill-debug.log');

const server = http.createServer((req, res) => {
  // Add CORS headers so content scripts/popup can fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${data.source}] [${data.level}]: ${data.message}\n`;
        fs.appendFileSync(logFile, logLine);
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 3050;
server.listen(PORT, () => {
  console.log(`Log server listening on http://localhost:${PORT}`);
  console.log(`Logs will be written to ${logFile}`);
  // Create or clear the log file
  fs.writeFileSync(logFile, `--- LOG SESSION STARTED AT ${new Date().toISOString()} ---\n`);
});
