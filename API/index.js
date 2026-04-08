const express = require('express');
const cheerio = require('cheerio');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, '../public'), { index: false }));

const encode = (str) => encodeURIComponent(Buffer.from(str).toString('base64'));
const decode = (str) => {
    try { return Buffer.from(decodeURIComponent(str), 'base64').toString('utf8'); }
    catch(e) { return str; }
};

app.all('*', async (req, res) => {
    // --- 1. AUTHENTICATION ---
    let pw = req.query.pw;
    let cookieHeader = req.headers.cookie || '';
    
    let cookies = {};
    cookieHeader.split(';').forEach(cookie => {
        let parts = cookie.split('=');
        if (parts.length === 2) cookies[parts[0].trim()] = parts[1].trim();
    });

    if (!pw && cookies['base_pw']) pw = cookies['base_pw'];

    if (pw !== process.env.PROXY_PASSWORD) {
        return res.status(401).send("Unauthorized. Please append ?pw=YOUR_PASSWORD to the URL to login.");
    }

    res.setHeader('Set-Cookie', `base_pw=${pw}; Path=/; Max-Age=31536000; SameSite=Lax`);

    let target = req.query.target;
    
    if (!target) {
        return res.sendFile(path.join(__dirname, '../public/index.html'));
    }
    
    target = decode(target);
    
    // --- 2. CUSTOM HEADLESS SEARCH ENGINE ---
    let isSearch = !target.includes('.') || target.includes(' ');
    
    if (isSearch) {
        try {
            const searchRes = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(target), {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const searchHtml = await searchRes.text();
            const $s = cheerio.load(searchHtml);
            
            let resultsHTML = '';
            
            $s('.result').slice(0, 10).each((i, el) => {
                const title = $s(el).find('.result__title a').text();
                const snippet = $s(el).find('.result__snippet').text();
                let rawLink = $s(el).find('.result__a').attr('href');
                
                if (title && rawLink) {
                    if (rawLink.startsWith('//duckduckgo.com/l/?')) {
                        const urlParams = new URLSearchParams(rawLink.split('?')[1]);
                        rawLink = decodeURIComponent(urlParams.get('uddg') || '');
                    }
                    const domain = new URL(rawLink).hostname;
                    const logo = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
                    const encodedLink = encode(rawLink);

                    resultsHTML += `
                        <div style="background:#111; padding:20px; border-radius:12px; margin-bottom:15px; border: 1px solid #222; transition: border-color 0.2s;">
                            <div style="display:flex; align-items:center; margin-bottom:8px;">
                                <img src="${logo}" style="width:20px; height:20px; margin-right:10px; border-radius:4px; background:#fff;">
                                <span style="color:#888; font-size:13px; font-weight:bold;">${domain}</span>
                            </div>
                            <a href="/?pw=${pw}&target=${encodedLink}" style="color:#fff; font-size:22px; text-decoration:none; font-weight:bold; display:block; margin-bottom:8px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${title}</a>
                            <p style="color:#aaa; font-size:15px; margin:0; line-height:1.6;">${snippet}</p>
                        </div>
                    `;
                }
            });

            const customUI = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Base Search</title>
                    <style>
                        body { background:#000; color:#fff; font-family:sans-serif; margin:0; padding:40px 20px; }
                        .container { max-width:800px; margin:0 auto; }
                        .header { display:flex; align-items:center; gap:20px; margin-bottom:40px; }
                        .logo { font-size:2rem; font-weight:900; letter-spacing:-2px; cursor:pointer; margin:0; }
                        input { flex-grow:1; padding:16px; border-radius:12px; border:1px solid #333; background:#111; color:#fff; font-size:16px; outline:none; }
                        button { padding:16px 30px; border-radius:12px; border:none; background:#fff; color:#000; font-weight:bold; cursor:pointer; font-size:16px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <form id="searchForm" class="header">
                            <h1 class="logo" onclick="window.parent.location.replace('/')">Base</h1>
                            <input type="text" id="s" value="${target}" autocomplete="off">
                            <button type="submit">Search</button>
                        </form>
                        <div id="results">${resultsHTML || '<h3 style="color:#888; text-align:center;">No results found.</h3>'}</div>
                    </div>
                    <script>
                        document.getElementById('searchForm').addEventListener('submit', e => {
                            e.preventDefault();
                            const val = document.getElementById('s').value;
                            window.location.replace('/?pw=${pw}&target=' + encodeURIComponent(btoa(val)));
                        });
                        document.addEventListener('click', e => {
                            const link = e.target.closest('a');
                            if (link && link.href.includes('target=')) {
                                e.preventDefault();
                                window.location.replace(link.href);
                            }
                        });
                    </script>
                </body>
                </html>
            `;
            res.setHeader('Content-Type', 'text/html');
            return res.send(customUI);
        } catch (err) {
            // PATCH: If search scraping fails, safely pass the search URL to the proxy engine below
            target = 'https://duckduckgo.com/?q=' + encodeURIComponent(target);
        }
    } 
    
    // --- 3. MAIN PROXY ENGINE ---
    // PATCH: No more 'else if'. Always flow into here if a target exists.
    if (!target.startsWith('http')) {
        target = 'https://' + target;
    }

    try {
        const response = await fetch(target, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Referer': new URL(target).origin
            }
        });

        const finalTarget = response.url;
        const contentType = response.headers.get('content-type') || '';

        // --- 4. MEDIA & ASSET HANDLER (Patched for Vercel 4.5MB Limits) ---
        if (!contentType.includes('text/html')) {
            const buffer = await response.arrayBuffer();
            
            // Vercel Serverless limits payload to 4.5MB. If it's bigger (e.g. video), bypass the proxy to prevent a 500 Crash.
            if (buffer.byteLength > 4400000) {
                return res.redirect(finalTarget); 
            }
            
            res.setHeader('Set-Cookie', `base_pw=${pw}; Path=/; Max-Age=31536000; SameSite=Lax`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'max-age=31536000');
            return res.send(Buffer.from(buffer));
        }

        // --- 5. HTML REWRITER ---
        let html = await response.text();
        const $ = cheerio.load(html);

        $('meta[http-equiv="refresh"]').remove();
        
        const rewrite = (tag, attr) => {
            $(tag).each((i, el) => {
                let val = $(el).attr(attr);
                if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('#')) {
                    try {
                        const absolute = new URL(val, finalTarget).href;
                        $(el).attr(attr, '/?pw=' + pw + '&target=' + encode(absolute));
                        if (tag === 'a') $(el).attr('target', '_self');
                    } catch(e) {}
                }
            });
        };

        ['img', 'script', 'link', 'source', 'a', 'iframe', 'form'].forEach(t => {
            const a = (t === 'link' || t === 'a') ? 'href' : (t === 'form' ? 'action' : 'src');
            rewrite(t, a);
        });

        // --- 6. CLIENT-SIDE INJECTIONS ---
        const vNav = `
            <script>
                const _encodeUrl = (url) => encodeURIComponent(btoa(url));
                const _baseUrl = "${finalTarget}"; 

                window.__tcfapi = function(cmd, ver, cb) { if(cb) cb(null, false); };
                window.__uspapi = function(cmd, ver, cb) { if(cb) cb(null, false); };

                window.onerror = function(msg, url, line, col, error) {
                    try { window.parent.postMessage({ type: 'base_error', log: msg + ' (Line: ' + line + ')' }, '*'); } catch(e) {}
                    return false; 
                };

                const origConsoleErr = console.error;
                console.error = function(...args) {
                    try {
                        const errString = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                        window.parent.postMessage({ type: 'base_error', log: errString }, '*');
                    } catch(e) {}
                    origConsoleErr.apply(console, args);
                };

                const _route = (url) => {
                    if (!url || typeof url !== 'string') return url;
                    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) return url;
                    try {
                        let abs = new URL(url, _baseUrl).href;
                        if (abs.startsWith('http') && !abs.includes(window.location.host)) {
                            return '/?target=' + _encodeUrl(abs);
                        }
                    } catch(e) {}
                    return url;
                };

                const origFetch = window.fetch;
                window.fetch = async function(resource, options) {
                    if (typeof resource === 'string') resource = _route(resource);
                    else if (resource && resource.url) resource = new Request(_route(resource.url), options);
                    return origFetch.call(this, resource, options);
                };

                const origOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    return origOpen.call(this, method, _route(url), ...rest);
                };

                const hookProperty = (proto, prop) => {
                    const desc = Object.getOwnPropertyDescriptor(proto, prop);
                    if (desc && desc.set) {
                        Object.defineProperty(proto, prop, {
                            set: function(val) { return desc.set.call(this, _route(val)); },
                            get: function() { return desc.get.call(this); }
                        });
                    }
                };
                hookProperty(HTMLScriptElement.prototype, 'src');
                hookProperty(HTMLLinkElement.prototype, 'href');
                hookProperty(HTMLImageElement.prototype, 'src');
                hookProperty(HTMLIFrameElement.prototype, 'src');

                document.addEventListener('click', e => {
                    const link = e.target.closest('a');
                    if (link && link.href) {
                        e.preventDefault();
                        if (!link.href.includes('target=')) window.location.replace(_route(link.href));
                        else window.location.replace(link.href);
                    }
                });

                document.addEventListener('submit', e => {
                    const form = e.target;
                    if (form.action && form.action.includes('target=')) {
                        e.preventDefault();
                        try {
                            const urlParams = new URLSearchParams(new URL(form.action).search);
                            const proxyTargetBase64 = urlParams.get('target');
                            if (proxyTargetBase64) {
                                const decodedAction = atob(decodeURIComponent(proxyTargetBase64));
                                if (!form.method || form.method.toLowerCase() === 'get') {
                                    const formData = new FormData(form);
                                    const searchParams = new URLSearchParams(formData).toString();
                                    const joiner = decodedAction.includes('?') ? '&' : '?';
                                    const finalTarget = _encodeUrl(decodedAction + joiner + searchParams);
                                    window.location.replace('/?target=' + finalTarget);
                                }
                            }
                        } catch (err) {}
                    } else if (form.action) {
                        e.preventDefault();
                        window.location.replace(_route(form.action));
                    }
                });

                window.open = (url) => { window.location.replace(_route(url)); return null; };
            </script>
        `;

        $('body').append(vNav);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send($.html());

    } catch (e) {
        // Safe Catch: Returns a real HTML error instead of timing out Vercel
        res.send("<body style='background:#000;color:#fff;text-align:center;padding:50px;font-family:sans-serif;'><h1>Connection Error</h1><p>The proxy could not fetch this page safely.</p><button onclick='window.parent.location.replace(\"/\")' style='padding:10px 20px;border-radius:10px;cursor:pointer;background:#fff;color:#000;font-weight:bold;border:none;'>Go Home</button></body>");
    }
});

module.exports = app;
