import { Actor, log } from 'apify';
import { validateInput, toOutput } from './lib.js';
import { collectJobs } from './pipeline.js';

await Actor.init();

const { input, errors } = validateInput((await Actor.getInput()) ?? {});
if (errors.length) {
    await Actor.fail(`Invalid input: ${errors.join(' ')}`);
}

await Actor.setStatusMessage('Fetching job feeds...');
const now = new Date();
const { jobs, sourceStatus } = await collectJobs(input, { now, log: (m) => log.warning(m) });

const failed = Object.entries(sourceStatus).filter(([, s]) => !s.ok);
if (failed.length === input.sources.length) {
    await Actor.setValue('SUMMARY', { ok: false, sourceStatus });
    await Actor.fail(`All sources failed: ${failed.map(([k, s]) => `${k} (${s.error})`).join('; ')}`);
}

let pushed = 0;
let limitReached = false;
for (const job of jobs) {
    // One billable "job-listing" event per dataset row, charged right after the row is stored.
    const result = await Actor.pushData(toOutput(job, { includeDescription: input.includeDescription, now }), 'job-listing');
    pushed++;
    if (result?.eventChargeLimitReached) {
        limitReached = true;
        log.warning('Maximum charged results per run reached; stopping early.');
        break;
    }
}

const summary = { ok: true, pushed, limitReached, requestedMax: input.maxItems, sourceStatus, finishedAt: new Date().toISOString() };
await Actor.setValue('SUMMARY', summary);
const warn = failed.length ? ` (source problems: ${failed.map(([k]) => k).join(', ')})` : '';
await Actor.setStatusMessage(pushed ? `Saved ${pushed} jobs${warn}` : `No jobs matched your filters${warn}`);
log.info('Done', summary);
await Actor.exit();
