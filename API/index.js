const express = require('express');
const path = require('path');
const cheerio = require('cheerio');
const app = express();

app.get('/', async (req, res) => {
    // 1. PASSWORD PROTECTION
    const userPass = req.query.pw;
    const correctPass = process.env.PROXY_PASSWORD;

    if (userPass !== correctPass) {
        return res.status(401).send("<h1>Access Denied</h1><p>Please add ?pw=YOUR_PASSWORD to the URL.</p>");
    }

    const targetUrl = req.query.target;

    // 2. LOAD UI IF NO TARGET IS PROVIDED
    if (!targetUrl) {
        // Vercel requires process.cwd() to find files in the public folder
        return res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
    }

    try {
        // 3. REBUILD URL FOR SEARCH ENGINES (Ignores internal variables)
        const fetchUrl = new URL(targetUrl);
        for (let key in req.query) {
            if (key !== 'target' && key !== 'pw') {
                fetchUrl.searchParams.append(key, req.query[key]);
            }
        }

        // 4. FETCH THE WEBSITE
        const response = await fetch(fetchUrl.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36)' }
        });
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const base = new URL(targetUrl);

        // 5. REWRITE LINKS (And keep password attached)
        $('a').each((i, link) => {
            let href = $(link).attr('href');
            if (href && !href.startsWith('javascript:')) {
                try {
                    let absoluteUrl = new URL(href, base.href).href;
                    $(link).attr('href', `/?pw=${userPass}&target=` + encodeURIComponent(absoluteUrl));
                } catch (e) {}
            }
        });

        // 6. REWRITE FORMS (And inject hidden password)
        $('form').each((i, form) => {
            let action = $(form).attr('action');
            if (action) {
                try {
                    let absoluteAction = new URL(action, base.href).href;
                    $(form).attr('action', '/');
                    $(form).append(`<input type="hidden" name="target" value="${absoluteAction}">`);
                    $(form).append(`<input type="hidden" name="pw" value="${userPass}">`);
                } catch (e) {}
            }
        });

        // 7. SEND TO BROWSER
        res.send($.html());
        
    } catch (error) {
        res.status(500).send('Error fetching the website. Make sure it includes https://');
    }
});

app.get('/*', (req, res) => {
    res.status(404).send('Proxy error: A file or path tried to escape the proxy.');
});

// DO NOT USE app.listen ON VERCEL. EXPORT THE APP INSTEAD!
module.exports = app;
