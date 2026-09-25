const http = require('node:http');

const port = Number(process.argv[2] || 43247);
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url.startsWith('/library/sections')) {
    response.end(JSON.stringify({ MediaContainer: { friendlyName: 'Minova QA Plex', Directory: [] } }));
    return;
  }
  response.end(JSON.stringify({ MediaContainer: { size: 0, Metadata: [], Directory: [], Hub: [] } }));
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`MOCK_PLEX_READY:${port}\n`));

process.on('SIGINT', () => server.close(() => process.exit(0)));
