import test from 'node:test';
import assert from 'node:assert/strict';
import {
    htmlToText, decodeEntities, parseSalaryText, normalizeJobType, normalizeJobicy, normalizeRemotive,
    matchesFilters, dedupeJobs, sortNewestFirst, validateInput, toOutput,
} from '../src/lib.js';
import { jobicyRaw, remotiveRaw } from './fixtures.js';

const NOW = new Date('2026-10-31T12:00:00Z');

test('decodeEntities handles named, decimal and hex entities and leaves unknown ones', () => {
    assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x41; &unknownthing;'), "a & b 'c' A &unknownthing;");
    assert.equal(decodeEntities(null), '');
});

test('htmlToText converts blocks to lines, lists to bullets and strips scripts', () => {
    const t = htmlToText('<h3>Hi</h3><p>One &amp; two</p><script>alert(1)</script><ul><li>A</li><li>B</li></ul>');
    assert.equal(t.replace(/\n{2,}/g, '\n'), 'Hi\nOne & two\n- A\n- B');
    assert.ok(!t.includes('alert'));
    assert.equal(htmlToText(''), '');
});

test('parseSalaryText understands k suffix, currency symbols and periods', () => {
    assert.deepEqual(parseSalaryText('$3.5k\u2013$5k/month'), { min: 3500, max: 5000, currency: 'USD', period: 'monthly' });
    assert.deepEqual(parseSalaryText('EUR 50,000 - 60,000 per year'), { min: 50000, max: 60000, currency: 'EUR', period: 'yearly' });
    assert.deepEqual(parseSalaryText('\u00a340/hour'), { min: 40, max: 40, currency: 'GBP', period: 'hourly' });
    assert.deepEqual(parseSalaryText('$80,000'), { min: 80000, max: 80000, currency: 'USD', period: 'yearly' });
    assert.deepEqual(parseSalaryText(''), { min: null, max: null, currency: null, period: null });
    assert.deepEqual(parseSalaryText('competitive'), { min: null, max: null, currency: null, period: null });
});

test('normalizeJobType maps the variants both sources use', () => {
    assert.equal(normalizeJobType('Full-Time'), 'full-time');
    assert.equal(normalizeJobType('full_time'), 'full-time');
    assert.equal(normalizeJobType('part_time'), 'part-time');
    assert.equal(normalizeJobType('Internship'), 'internship');
    assert.equal(normalizeJobType(''), 'other');
});

test('normalizeJobicy keeps the Jobicy URL and numeric salary', () => {
    const j = normalizeJobicy(jobicyRaw);
    assert.equal(j.id, 'jobicy:158260');
    assert.equal(j.sourceUrl, jobicyRaw.url);
    assert.deepEqual([j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod], [151300, 229900, 'USD', 'yearly']);
    assert.equal(j.seniority, null);
    assert.equal(j.publishedAt, '2026-10-31T09:05:04.000Z');
    assert.deepEqual(j.jobTypes, ['full-time']);
});

test('normalizeRemotive parses text salary and treats naive timestamps as UTC', () => {
    const j = normalizeRemotive(remotiveRaw);
    assert.equal(j.id, 'remotive:2091165');
    assert.equal(j.worldwide, true);
    assert.deepEqual([j.salaryMin, j.salaryMax, j.salaryPeriod], [3500, 5000, 'monthly']);
    assert.equal(j.publishedAt, '2026-10-29T18:22:41.000Z');
    assert.deepEqual(j.tags, ['api', 'AWS', 'react']);
    assert.equal(j.salaryText, '$3.5k\u2013$5k/month');
});

test('matchesFilters: search, exclude, location, categories, types, salary, age', () => {
    const a = normalizeJobicy(jobicyRaw);
    const b = normalizeRemotive(remotiveRaw);
    const base = { postedWithinDays: 7 };
    assert.equal(matchesFilters(a, { ...base, searchTerms: ['python'] }, NOW), true, 'description match');
    assert.equal(matchesFilters(a, { ...base, searchTerms: ['rust', 'golang'] }, NOW), false);
    assert.equal(matchesFilters(a, { ...base, excludeTerms: ['thumbtack'] }, NOW), false);
    assert.equal(matchesFilters(b, { ...base, location: 'worldwide' }, NOW), true);
    assert.equal(matchesFilters(a, { ...base, location: 'worldwide' }, NOW), false);
    assert.equal(matchesFilters(a, { ...base, location: 'usa' }, NOW), true);
    assert.equal(matchesFilters(a, { ...base, categories: ['engineering'] }, NOW), true);
    assert.equal(matchesFilters(a, { ...base, categories: ['marketing'] }, NOW), false);
    assert.equal(matchesFilters(b, { ...base, jobTypes: ['full-time'] }, NOW), false);
    assert.equal(matchesFilters(b, { ...base, jobTypes: ['contract'] }, NOW), true);
    assert.equal(matchesFilters(b, { ...base, requireSalary: true }, NOW), true);
    assert.equal(matchesFilters({ ...b, salaryMin: null, salaryMax: null }, { requireSalary: true }, NOW), false);
    assert.equal(matchesFilters(b, { postedWithinDays: 1 }, NOW), false, 'older than a day');
    assert.equal(matchesFilters(b, { postedWithinDays: 0 }, NOW), true, '0 = unlimited');
});

test('dedupeJobs merges same company+title across sources and keeps salary', () => {
    const a = { ...normalizeJobicy(jobicyRaw), salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };
    const b = { ...normalizeRemotive(remotiveRaw), company: 'Thumbtack', title: 'Full-Stack Engineer AI Platform' };
    const out = dedupeJobs([a, b, normalizeRemotive({ ...remotiveRaw, id: 7, company_name: 'Other', title: 'Different' })]);
    assert.equal(out.length, 2);
    assert.equal(out[0].alsoListedOn.length, 1);
    assert.equal(out[0].alsoListedOn[0].source, 'remotive');
    assert.equal(out[0].salaryMin, 3500, 'salary borrowed from the duplicate');
    assert.deepEqual(dedupeJobs([]), []);
});

test('sortNewestFirst is stable for missing dates', () => {
    const s = sortNewestFirst([{ publishedAt: '2026-01-01T00:00:00Z' }, { publishedAt: null }, { publishedAt: '2026-02-01T00:00:00Z' }]);
    assert.deepEqual(s.map((x) => x.publishedAt), ['2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z', null]);
});

test('toOutput honours description format and always adds attribution', () => {
    const j = normalizeJobicy(jobicyRaw);
    const text = toOutput(j, { includeDescription: 'text', now: NOW });
    assert.match(text.description, /Build & ship Python services/);
    assert.match(text.attribution, /Jobicy/);
    assert.equal(text.scrapedAt, NOW.toISOString());
    assert.equal('descriptionHtml' in text, false);
    assert.match(toOutput(j, { includeDescription: 'html', now: NOW }).description, /<h3>/);
    assert.equal('description' in toOutput(j, { includeDescription: 'none', now: NOW }), false);
});

test('validateInput applies defaults and reports every problem', () => {
    const ok = validateInput({});
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.input.sources, ['jobicy', 'remotive']);
    assert.equal(ok.input.maxItems, 50);
    const bad = validateInput({ sources: ['indeed'], maxItems: 0, jobTypes: ['gig'], includeDescription: 'pdf', postedWithinDays: -1, searchTerms: [1] });
    assert.equal(bad.errors.length, 6);
});
