const http = require('http');
const httpProxy = require('http-proxy');

// Create a proxy server instance
const proxy = httpProxy.createProxyServer({});

// Create the main server
const server = http.createServer((req, res) => {
  // Extract the target URL from the query string
  // Example: your-app.onrender.com/?target=https://google.com
  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  const target = urlParams.searchParams.get('target');

  if (target) {
    proxy.web(req, res, { target: target, changeOrigin: true }, (e) => {
      res.writeHead(500);
      res.end("Proxy Error: Check if the URL is valid.");
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end("Proxy is active. Usage: /?target=https://example.com");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
