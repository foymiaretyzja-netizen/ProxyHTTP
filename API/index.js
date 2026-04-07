const express = require('express');
const cheerio = require('cheerio');
const app = express();

const encode = (str) => Buffer.from(str).toString('base64');
const decode = (str) => {
    try { return Buffer.from(str, 'base64').toString('utf8'); }
    catch(e) { return str; }
};

const uiHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="https://www.google.com/favicon.ico" type="image/x-icon">
    <title>Google Drive</title>
    <style>
        body { font-family: sans-serif; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { text-align: center; }
        h1 { font-size: 5rem; margin: 0; letter-spacing: -4px; font-weight: 900; }
        input { width: 320px; padding: 18px; border-radius: 14px; border: 1px solid #222; background: #111; color: #fff; margin-bottom: 15px; outline: none; font-size: 16px; }
        button { width: 358px; padding: 18px; border-radius: 14px; border: none; background: #fff; color: #000; font-weight: 700; cursor: pointer; font-size: 16px; }
    </style>
</head>
<body>
    <div class="box">
        <h1>Base</h1>
        <form id="p">
            <input type="url" id="u" placeholder="Enter URL..." required><br>
            <button type="submit">Launch</button>
        </form>
    </div>
    <script>
        document.getElementById('p').addEventListener('submit', e => {
            e.preventDefault();
            const urlParams = new URLSearchParams(window.location.search);
            const target = document.getElementById('u').value;
            location.href = '/?pw=' + (urlParams.get('pw')||'') + '&target=' + btoa(target);
        });
    </script>
</body>
</html>
`;

app.all('*', async (req, res) => {
    const pw = req.query.pw;
    if (pw !== process.env.PROXY_PASSWORD) return res.status(401).send("Unauthorized");

    let target = req.query.target;
    if (!target) return res.send(uiHTML);
    target = decode(target);

    try {
        const response = await fetch(target, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const contentType = response.headers.get('content-type') || '';

        if (!contentType.includes('text/html')) {
            const buffer = await response.arrayBuffer();
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(Buffer.from(buffer));
        }

        let html = await response.text();
        const $ = cheerio.load(html);
        const origin = new URL(target).origin;

        // CLOAKING
        $('title').text('Google Drive');
        $('head').append('<link rel="icon" href="https://www.google.com/favicon.ico" type="image/x-icon">');
        $('head').prepend(`<base href="${origin}/">`);

        // REWRITING ATTRIBUTES
        const rewriteAttr = (tag, attr) => {
            $(tag).each((i, el) => {
                let val = $(el).attr(attr);
                if (val && !val.startsWith('data:') && !val.startsWith('javascript:')) {
                    try {
                        const absolute = new URL(val, target).href;
                        $(el).attr(attr, `/?pw=${pw}&target=${encode(absolute)}`);
                        
                        // NEW: FORCING SAME-TAB NAVIGATION
                        if (tag === 'a') {
                            $(el).attr('target', '_self');
                        }
                    } catch(e) {}
                }
            });
        };

        ['img', 'script', 'link', 'source', 'a', 'iframe', 'form'].forEach(t => {
            const a = (t === 'link' || t === 'a') ? 'href' : (t === 'form' ? 'action' : 'src');
            rewriteAttr(t, a);
        });

        // STEALTH UI + JS INTERCEPTORS
        const inject = `
            <div id="base-ui" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.9);color:#fff;padding:10px 20px;border-radius:50px;z-index:9999999;display:none;border:1px solid #333;font-family:sans-serif;">
                <b>Base</b> | <button onclick="location.href='/?pw=${pw}'">Home</button>
            </div>
            <script>
                // 1. Keyboard Toggle
                document.addEventListener('keydown', e => {
                    if(e.shiftKey && e.key.toLowerCase() === 'q') {
                        const ui = document.getElementById('base-ui');
                        ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
                    }
                });

                // 2. JS Window.open Interceptor (Prevents scripts from opening new tabs)
                window.open = function(url) {
                    location.href = url;
                    return null;
                };

                // 3. Dynamic Link Catcher (Catches links added after the page loads)
                document.addEventListener('click', e => {
                    const link = e.target.closest('a');
                    if (link && link.target === '_blank') {
                        link.target = '_self';
                    }
                });
            </script>
        `;

        $('body').append(inject);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send($.html());

    } catch (e) {
        res.status(500).send("Error.");
    }
});

module.exports = app;
