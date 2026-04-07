const express = require('express');
const path = require('path');
const app = express();

app.get('/', async (req, res) => {
    const targetUrl = req.query.target;

    // 1. If there is no target, send the index.html page!
    if (!targetUrl) {
        return res.sendFile(path.join(__dirname, 'index.html'));
    }

    // 2. If there is a target, run the proxy logic
    try {
        const response = await fetch(targetUrl);
        let html = await response.text();

        // 3. Find and Replace links to keep the user inside the proxy
        const origin = new URL(targetUrl).origin;
        html = html.replace(/href="(\/[^"]+)"/g, `href="/?target=${origin}$1"`);
        html = html.replace(/src="(\/[^"]+)"/g, `src="/?target=${origin}$1"`);

        res.send(html);
        
    } catch (error) {
        res.status(500).send('Error fetching the website. Make sure it includes https://');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Prototype ready on port ${PORT}!`));
