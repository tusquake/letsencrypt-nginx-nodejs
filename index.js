const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello from my secure Node app! SSL Termination worked!\n');
});

server.listen(3000, '127.0.0.1', () => {
    console.log('Server running on http://127.0.0.1:3000/');
});
