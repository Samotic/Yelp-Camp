// TEMPORARY DIAGNOSTIC - delete this file and its call sites when the routing
// issue is resolved.
//
// The log path below is a local Windows path. On Vercel the filesystem is
// read-only apart from /tmp, so every call used to attempt a write that threw
// and was silently swallowed, on every single request. Now it is inert unless
// DIFFLOG=1 is set locally.
const fs = require('fs');
const LOG = 'C:\\Users\\samka\\AppData\\Local\\Temp\\claude\\c--Users-samka-Downloads-YelpCamp\\c0f7baf1-357f-4213-a560-0ceccace4bde\\scratchpad\\returnto.log';

const ENABLED = process.env.DIFFLOG === '1' && !process.env.VERCEL;

module.exports = (tag, req, extra = {}) => {
    if (!ENABLED) return;
    const line = JSON.stringify({
        t: new Date().toISOString().slice(11, 23),
        tag,
        method: req.method,
        url: req.originalUrl,
        ref: req.get('Referrer'),
        sid: req.sessionID,
        auth: typeof req.isAuthenticated === 'function' ? req.isAuthenticated() : null,
        user: req.user && req.user.username,
        returnTo: req.session && req.session.returnTo,
        ...extra
    });
    try { fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* ignore */ }
};
