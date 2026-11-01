const UA = 'Mozilla/5.0 (compatible; RemoteJobsFeedActor/0.1; Apify Actor)';
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SourceError extends Error {
    constructor(message, status) { super(message); this.name = 'SourceError'; this.status = status; }
}

/** GET JSON with timeout and retries on 429, 5xx and network errors. */
export async function fetchJson(url, { fetchImpl = fetch, retries = 3, timeoutMs = 25000, sleep = defaultSleep } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
            clearTimeout(timer);
            if (res.status === 429 || res.status >= 500) {
                const retryAfter = Number(res.headers?.get?.('retry-after'));
                lastErr = new SourceError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
                if (attempt < retries) await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, 30000));
                continue;
            }
            if (!res.ok) throw new SourceError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
            try {
                return await res.json();
            } catch {
                throw new SourceError(`Invalid JSON from ${new URL(url).host}`, res.status);
            }
        } catch (err) {
            clearTimeout(timer);
            if (err instanceof SourceError && err.status && err.status < 500 && err.status !== 429) throw err;
            lastErr = err instanceof SourceError ? err : new SourceError(`Network error for ${new URL(url).host}: ${err.message}`);
            if (attempt < retries) await sleep(1000 * 2 ** attempt);
        }
    }
    throw lastErr;
}

/** Async generator of raw Jobicy job arrays. Jobicy serves the last 7 days, newest first, up to 100 per page. */
export async function* jobicyPages({ fetchImpl, sleep, maxPages = 10 } = {}) {
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
        const qs = new URLSearchParams({ count: '100' });
        if (cursor) qs.set('cursor', cursor);
        const data = await fetchJson(`https://jobicy.com/api/jobs?${qs}`, { fetchImpl, sleep });
        if (data?.success === false) throw new SourceError(`Jobicy API error: ${data.error ?? 'unknown'}`);
        if (!Array.isArray(data?.jobs)) throw new SourceError('Jobicy response had no jobs array');
        yield data.jobs;
        cursor = data.nextCursor;
        if (!cursor || data.hasMore === false) return;
    }
}

/** Remotive returns its whole (24h delayed) public feed in one response. Call it once per run. */
export async function fetchRemotive({ fetchImpl, sleep } = {}) {
    const data = await fetchJson('https://remotive.com/api/remote-jobs', { fetchImpl, sleep });
    if (!Array.isArray(data?.jobs)) throw new SourceError('Remotive response had no jobs array');
    return data.jobs;
}
