import { jobicyPages, fetchRemotive } from './sources.js';
import { normalizeJobicy, normalizeRemotive, matchesFilters, dedupeJobs, sortNewestFirst } from './lib.js';

/**
 * Fetch every selected source, normalise, filter, merge, dedupe.
 * A failing source never aborts the run; it is reported in sourceStatus.
 */
export async function collectJobs(input, { fetchImpl, sleep, now = new Date(), log = () => {} } = {}) {
    const sourceStatus = {};
    const perSource = [];

    for (const source of input.sources) {
        const matched = [];
        let fetched = 0;
        try {
            if (source === 'jobicy') {
                for await (const page of jobicyPages({ fetchImpl, sleep })) {
                    fetched += page.length;
                    for (const raw of page) {
                        const job = normalizeJobicy(raw);
                        if (matchesFilters(job, input, now)) matched.push(job);
                    }
                    if (matched.length >= input.maxItems) break;
                }
            } else if (source === 'remotive') {
                const raws = await fetchRemotive({ fetchImpl, sleep });
                fetched = raws.length;
                for (const raw of raws) {
                    const job = normalizeRemotive(raw);
                    if (matchesFilters(job, input, now)) matched.push(job);
                }
            }
            sourceStatus[source] = { ok: true, fetched, matched: matched.length };
            perSource.push(...matched.slice(0, input.maxItems));
        } catch (err) {
            log(`Source ${source} failed: ${err.message}`);
            sourceStatus[source] = { ok: false, fetched, matched: matched.length, error: err.message };
            perSource.push(...matched.slice(0, input.maxItems));
        }
    }

    let jobs = sortNewestFirst(perSource);
    if (input.dedupe) jobs = dedupeJobs(jobs);
    return { jobs: jobs.slice(0, input.maxItems), sourceStatus };
}
