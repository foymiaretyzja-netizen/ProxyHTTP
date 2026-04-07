const express = require('express');
const cheerio = require('cheerio');
const app = express();

const uiHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Browser Prototype</title>
    <style>
        body { font-family: sans-serif; background-color: #1a1a1a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .container { text-align: center; border: 1px solid #333; padding: 40px; border-radius: 12px; background: #222; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        input[type="url"] { width: 350px; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #333; color: white; margin-bottom: 20px; }
        button { padding: 12px 24px; border-radius: 6px; border: none; background-color: #007bff; color: white; cursor: pointer; font-weight: bold; }
        button:hover { background-color: #0056b3; }
        p { color: #888; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Netizen Proxy</h1>
        <form id="proxyForm">
            <input type="url" id="targetUrl" placeholder="https://example.com" required><br>
            <button type="submit">Launch Browser</button>
        </form>
        <p>Press <strong>Shift + Q</strong> while browsing to open settings.</p>
    </div>
    <script>
        document.getElementById('proxyForm').addEventListener('submit', function(event) {
            event.preventDefault(); 
            const url = document.getElementById('targetUrl').value;
            const urlParams = new URLSearchParams(window.location.search);
            const pw = urlParams.get('pw') || '';
            window.location.href = '/?pw=' + encodeURIComponent(pw) + '&target=' + encodeURIComponent(url);
        });
    </script>
</body>
</html>
`;

app.all('*', async (req, res) => {
    const userPass = req.query.pw;
    const correctPass = process.env.PROXY_PASSWORD;

    if (userPass !== correctPass) {
        return res.status(401).send("<h1>Access Denied</h1>");
    }

    const targetUrl = req.query.target;
    if (!targetUrl) return res.send(uiHTML);

    const blocklist = ['netflix.com', 'hulu.com', 'chase.com', 'bankofamerica.com'];
    if (targetUrl && blocklist.some(domain => targetUrl.toLowerCase().includes(domain))) {
        return res.status(403).send("<h1>Domain Blocked for Safety</h1>");
    }

    try {
        const response = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        let html = await response.text();
        const $ = cheerio.load(html);
        const base = new URL(targetUrl);

        // REWRITE LINKS & FORMS
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href && !href.startsWith('javascript:')) {
                try {
                    $(el).attr('href', `/?pw=${userPass}&target=` + encodeURIComponent(new URL(href, base).href));
                } catch(e){}
            }
        });

        // INJECT BROWSER UI (The Panel)
        const injectScripts = `
            <style>
                #proxy-ui { position: fixed; top: 20px; right: 20px; background: #222; color: white; padding: 15px; border-radius: 8px; z-index: 999999; display: none; font-family: sans-serif; box-shadow: 0 5px 15px rgba(0,0,0,0.5); border: 1px solid #444; }
                #proxy-ui button { margin: 5px; padding: 8px; cursor: pointer; background: #444; color: white; border: none; border-radius: 4px; }
                #proxy-ui button:hover { background: #666; }
                .dark-mode-active { filter: invert(1) hue-rotate(180deg); background-color: #fff; }
            </style>
            <div id="proxy-ui">
                <strong style="display:block; margin-bottom:10px;">Browser Controls</strong>
                <button onclick="window.location.href='/?pw=${userPass}'">Home</button>
                <button onclick="document.documentElement.classList.toggle('dark-mode-active')">Toggle Dark</button>
                <button onclick="document.getElementById('proxy-ui').style.display='none'">Close (Shift+Q)</button>
            </div>
            <script>
                document.addEventListener('keydown', function(e) {
                    if (e.shiftKey && e.key.toLowerCase() === 'q') {
                        const ui = document.getElementById('proxy-url') || document.getElementById('proxy-ui');
                        ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
                    }
                });
            </script>
        `;
        
        $('body').append(injectScripts);
        res.send($.html());
        
    } catch (error) {
        res.status(500).send('Error loading page.');
    }
});

module.exports = app;
