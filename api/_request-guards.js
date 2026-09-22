// HTTP boundary only: no simulation state, provider calls, or persistent identifiers.
const { isIP } = require('node:net');
function normalizedIP(value) {
    if (typeof value !== 'string' || !isIP(value)) return null;
    if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
    return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}
function clientIP(req, railway = !!process.env.RAILWAY_ENVIRONMENT_ID) {
    // Railway overwrites X-Real-IP at its edge, including verified Cloudflare visitor addresses.
    // Never trust caller-supplied CF-Connecting-IP or X-Forwarded-For on the direct Railway URL.
    return (railway && normalizedIP(req.headers['x-real-ip']))
        || normalizedIP(req.socket?.remoteAddress) || 'unknown';
}
function localRequest(req) {
    if (process.env.NODE_ENV === 'production') return false;
    const ip = normalizedIP(req.socket?.remoteAddress);
    if (ip !== '127.0.0.1' && ip !== '::1') return false;
    const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    try {
        if (!loopback(new URL(`http://${req.headers.host}`).hostname)) return false;
        return !req.headers.origin || loopback(new URL(req.headers.origin).hostname);
    } catch { return false; }
}
const BODY_LIMIT = 128 * 1024;
function readJSON(req, timeoutMs = 10_000) {
    if (Number(req.headers['content-length']) > BODY_LIMIT) return Promise.reject({ status: 413 });
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return Promise.reject({ status: 415 });
    return new Promise((resolve, reject) => {
        let size = 0, chunks = [], done = false;
        const finish = (error, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            req.removeListener('data', data); req.removeListener('end', end);
            req.removeListener('aborted', aborted); req.removeListener('error', aborted);
            chunks = [];
            if (error) { req.pause(); reject(error); } else resolve(value);
        };
        const data = chunk => {
            size += chunk.length;
            if (size > BODY_LIMIT) return finish({ status: 413 });
            chunks.push(chunk);
        };
        const end = () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
                finish(null, body);
            } catch { finish({ status: 400 }); }
        };
        const aborted = () => finish({ status: 400 });
        const timer = setTimeout(() => finish({ status: 408 }), timeoutMs);
        req.on('data', data); req.on('end', end); req.on('aborted', aborted); req.on('error', aborted);
    });
}
// Separate allowances: automatic town prose cannot spend the player's whisper allowance.
// A whisper uses classify + reply (two requests). Global provider token/$ budgets still apply.
const POLICIES = { interactive: { burst: 120, daily: 600 }, background: { burst: 40, daily: 200 } };
const BURST_MS = 600_000, DAY_MS = 86_400_000;
class RequestLimits {
    constructor({ now = Date.now, capacity = 10_000 } = {}) { this.now = now; this.capacity = capacity; this.entries = new Map(); this.active = 0; }
    acquire(ip, channel) {
        const now = this.now();
        let entry = this.entries.get(ip);
        if (!entry) {
            if (this.entries.size >= this.capacity) {
                for (const [key, value] of this.entries) if (!value.active && now - value.touched >= DAY_MS) this.entries.delete(key);
            }
            // Never evict an active daily allowance: cycling addresses must not reset other counters.
            if (this.entries.size >= this.capacity) return { status: 503, retry: 60 };
            entry = { active: 0, touched: now, buckets: {} }; this.entries.set(ip, entry);
        }
        if (entry.active >= 4 || this.active >= 32) return { status: 429, retry: 5 };
        const b = entry.buckets[channel] ||= { burst: 0, daily: 0, burstStart: now, dayStart: now };
        if (now - b.burstStart >= BURST_MS) { b.burst = 0; b.burstStart = now; }
        if (now - b.dayStart >= DAY_MS) { b.daily = 0; b.dayStart = now; }
        const policy = POLICIES[channel];
        let wait = 0;
        if (b.burst >= policy.burst) wait = b.burstStart + BURST_MS - now;
        if (b.daily >= policy.daily) wait = Math.max(wait, b.dayStart + DAY_MS - now);
        if (wait > 0) return { status: 429, retry: Math.max(1, Math.ceil(wait / 1000)) };
        b.burst++; b.daily++; entry.touched = now; entry.active++; this.active++;
        let released = false;
        return { release: () => { if (!released) { released = true; entry.active--; this.active--; } } };
    }
}
module.exports = { clientIP, localRequest, readJSON, RequestLimits, BODY_LIMIT };
