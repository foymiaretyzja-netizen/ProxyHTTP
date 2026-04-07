const express = require('express');
const cheerio = require('cheerio');
const app = express();

const uiHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Base</title>
    <style>
        body { font-family: sans-serif; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { text-align: center; border: 1px solid #222; padding: 50px; border-radius: 20px; background: #0a0a0a; }
        h1 { font-size: 40px; margin-bottom: 20px; letter-spacing: -1px; }
        input { width: 300px; padding: 15px; border-radius: 10px; border: 1px solid #333; background: #111; color: #fff; margin-bottom: 10px; }
        button { width: 330px; padding: 15px; border-radius: 10px; border: none; background: #fff; color: #000; font-weight: bold; cursor: pointer; }
    </style>
</head>
<body>
    <div class="box">
        <h1>Base</h1>
        <form id="p">
            <input type="url" id="u" placeholder="https://..." required><br>
            <button type="submit">Go</button>
        </form>
    </div>
    <script>
        document.getElementById('p').addEventListener('submit', e => {
            e.preventDefault();
            const urlParams = new URLSearchParams(window.location.search);
            location.href = '/?pw=' + (urlParams.get('pw')||'') + '&target=' + encodeURIComponent(document.getElementById('u').value);
        });
    </script>
</body>
</html>
`;

app.all('*', async (req, res) => {
    const pw = req.query.pw;
    if (pw !== process.env.PROXY_PASSWORD) return res.status(401).send("Unauthorized");

    const target = req.query.target;
    if (!target) return res.send(uiHTML);

    try {
        const response = await fetch(target, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        // Determine if we are fetching HTML or an asset (Image/CSS)
        const contentType = response.headers.get('content-type');

        // If it's an image, script, or stylesheet, pipe the data directly
        if (!contentType || !contentType.includes('text/html')) {
            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', contentType);
            return res.send(Buffer.from(buffer));
        }

        // If it's HTML, we rewrite it
        let html = await response.text();
        const $ = cheerio.load(html);
        const origin = new URL(target).origin;

        // Force images, scripts, and styles to go through the proxy too
        $('img, script, link, source').each((i, el) => {
            const attr = $(el).attr('src') ? 'src' : 'href';
            let val = $(el).attr(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('http')) {
                const absolute = new URL(val, target).href;
                // We point the asset back to our proxy
                $(el).attr(attr, `/?pw=${pw}&target=${encodeURIComponent(absolute)}`);
            }
        });

        // Rewrite links to keep browsing
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                const absolute = new URL(href, target).href;
                $(el).attr('href', `/?pw=${pw}&target=${encodeURIComponent(absolute)}`);
            }
        });

        // Inject the Shift + Q UI
        const panel = `
            <div id="b-ui" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:10px;z-index:99999;display:none;border:1px solid #333;font-family:sans-serif;">
                <b>Base</b> | <button onclick="location.href='/?pw=${pw}'">Home</button> | <button onclick="location.reload()">Refresh</button>
            </div>
            <script>
                document.addEventListener('keydown', e => {
                    if(e.shiftKey && e.key.toLowerCase() === 'q') {
                        const ui = document.getElementById('b-ui');
                        ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
                    }
                });
            </script>
        `;

        $('body').append(panel);
        res.send($.html());

    } catch (e) {
        res.status(500).send("Error loading site.");
    }
});

module.exports = app;
