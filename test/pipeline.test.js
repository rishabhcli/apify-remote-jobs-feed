import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, jobicyPages, fetchRemotive } from '../src/sources.js';
import { collectJobs } from '../src/pipeline.js';
import { validateInput } from '../src/lib.js';
import { jobicyRaw, remotiveRaw } from './fixtures.js';

const NOW = new Date('2026-10-31T12:00:00Z');
const noSleep = async () => {};
const resp = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });

test('fetchJson retries on 429 then succeeds and honours Retry-After', async () => {
    const waits = [];
    let n = 0;
    const fetchImpl = async () => (++n < 3 ? resp({}, 429, { 'retry-after': '2' }) : resp({ ok: true }));
    const out = await fetchJson('https://example.com/x', { fetchImpl, sleep: async (ms) => waits.push(ms) });
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(waits, [2000, 2000]);
});

test('fetchJson gives up after retries on 5xx', async () => {
    const fetchImpl = async () => resp({}, 503);
    await assert.rejects(fetchJson('https://example.com/x', { fetchImpl, sleep: noSleep, retries: 2 }), /HTTP 503/);
});

test('fetchJson does not retry a 404', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return resp({}, 404); };
    await assert.rejects(fetchJson('https://example.com/x', { fetchImpl, sleep: noSleep }), /HTTP 404/);
    assert.equal(n, 1);
});

test('fetchJson reports invalid JSON clearly', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad'); } });
    await assert.rejects(fetchJson('https://example.com/x', { fetchImpl, sleep: noSleep }), /Invalid JSON/);
});

test('jobicyPages follows nextCursor until hasMore is false', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(url);
        return url.includes('cursor=c1')
            ? resp({ success: true, jobs: [{ id: 2 }], nextCursor: null, hasMore: false })
            : resp({ success: true, jobs: [{ id: 1 }], nextCursor: 'c1', hasMore: true });
    };
    const pages = [];
    for await (const p of jobicyPages({ fetchImpl, sleep: noSleep })) pages.push(p);
    assert.equal(pages.length, 2);
    assert.match(urls[1], /cursor=c1/);
    assert.match(urls[0], /count=100/);
});

test('jobicyPages surfaces API-level errors', async () => {
    const fetchImpl = async () => resp({ success: false, error: 'rate limited' });
    await assert.rejects(async () => { for await (const _ of jobicyPages({ fetchImpl, sleep: noSleep })); }, /rate limited/);
});

test('fetchRemotive requires a jobs array', async () => {
    await assert.rejects(fetchRemotive({ fetchImpl: async () => resp({ nope: 1 }), sleep: noSleep }), /no jobs array/);
    const jobs = await fetchRemotive({ fetchImpl: async () => resp({ jobs: [remotiveRaw] }), sleep: noSleep });
    assert.equal(jobs.length, 1);
});

const fakeFetch = ({ jobicyFail = false, remotiveFail = false } = {}) => async (url) => {
    if (url.includes('jobicy.com')) return jobicyFail ? resp({}, 500) : resp({ success: true, jobs: [jobicyRaw], nextCursor: null, hasMore: false });
    if (url.includes('remotive.com')) return remotiveFail ? resp({}, 500) : resp({ jobs: [remotiveRaw] });
    throw new Error(`unexpected url ${url}`);
};

test('collectJobs merges both sources newest first and applies maxItems', async () => {
    const { input } = validateInput({ maxItems: 5 });
    const { jobs, sourceStatus } = await collectJobs(input, { fetchImpl: fakeFetch(), sleep: noSleep, now: NOW });
    assert.deepEqual(jobs.map((j) => j.source), ['jobicy', 'remotive']);
    assert.deepEqual(sourceStatus.jobicy, { ok: true, fetched: 1, matched: 1 });
    const one = await collectJobs(validateInput({ maxItems: 1 }).input, { fetchImpl: fakeFetch(), sleep: noSleep, now: NOW });
    assert.equal(one.jobs.length, 1);
});

test('collectJobs applies filters per source', async () => {
    const { input } = validateInput({ jobTypes: ['contract'] });
    const { jobs } = await collectJobs(input, { fetchImpl: fakeFetch(), sleep: noSleep, now: NOW });
    assert.deepEqual(jobs.map((j) => j.source), ['remotive']);
});

test('collectJobs survives one failing source and reports it', async () => {
    const { input } = validateInput({});
    const { jobs, sourceStatus } = await collectJobs(input, { fetchImpl: fakeFetch({ remotiveFail: true }), sleep: noSleep, now: NOW });
    assert.equal(jobs.length, 1);
    assert.equal(sourceStatus.remotive.ok, false);
    assert.match(sourceStatus.remotive.error, /HTTP 500/);
    assert.equal(sourceStatus.jobicy.ok, true);
});

test('collectJobs only calls the selected sources', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(new URL(url).host); return fakeFetch()(url); };
    await collectJobs(validateInput({ sources: ['remotive'] }).input, { fetchImpl, sleep: noSleep, now: NOW });
    assert.deepEqual(calls, ['remotive.com']);
});
