const express = require('express');
const path = require('path');
const cheerio = require('cheerio');
const app = express();

app.get('/', async (req, res) => {
    const targetUrl = req.query.target;

    if (!targetUrl) {
        return res.sendFile(path.join(__dirname, 'index.html'));
    }

    try {
        // 1. REBUILD THE URL WITH SEARCH TERMS
        // If you searched for something, the browser adds it to the query (e.g., &q=cats)
        // We need to attach those search terms back onto the target URL
        const fetchUrl = new URL(targetUrl);
        for (let key in req.query) {
            if (key !== 'target') {
                fetchUrl.searchParams.append(key, req.query[key]);
            }
        }

        // 2. FETCH THE TARGET
        // We add a User-Agent header so Google doesn't instantly block us as a bot
        const response = await fetch(fetchUrl.toString(), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36)'
            }
        });
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const base = new URL(targetUrl);

        // 3. REWRITE LINKS (What we did last time)
        $('a').each((i, link) => {
            let href = $(link).attr('href');
            if (href && !href.startsWith('javascript:')) {
                try {
                    let absoluteUrl = new URL(href, base.href).href;
                    $(link).attr('href', '/?target=' + encodeURIComponent(absoluteUrl));
                } catch (e) {}
            }
        });

        // 4. REWRITE FORMS (The new fix for Google Search!)
        $('form').each((i, form) => {
            let action = $(form).attr('action');
            if (action) {
                try {
                    let absoluteAction = new URL(action, base.href).href;
                    // Force the form to submit to our proxy
                    $(form).attr('action', '/');
                    // Smuggle the real destination in a hidden input
                    $(form).append(`<input type="hidden" name="target" value="${absoluteAction}">`);
                } catch (e) {}
            }
        });

        res.send($.html());
        
    } catch (error) {
        res.status(500).send('Error fetching the website. It might be blocking the proxy.');
    }
});

// A catch-all route just in case a stray request slips through
app.get('/*', (req, res) => {
    res.status(404).send('Proxy error: A file or path tried to escape the proxy.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Search-enabled Prototype ready on port ${PORT}!`));
