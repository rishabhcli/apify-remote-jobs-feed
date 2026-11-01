// Pure helpers: no network, no Apify SDK. Everything here is unit tested.

export const SOURCES = ['jobicy', 'remotive'];
export const JOB_TYPES = ['full-time', 'part-time', 'contract', 'freelance', 'internship', 'other'];

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', mdash: '-', ndash: '-',
    rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', bull: '-', euro: 'EUR', pound: 'GBP', copy: '(c)', reg: '(R)',
};

export function decodeEntities(str) {
    return String(str ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
        }
        const v = NAMED_ENTITIES[e.toLowerCase()];
        return v === undefined ? m : v;
    });
}

export function htmlToText(html) {
    if (!html) return '';
    let s = String(html);
    s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<li[^>]*>/gi, '\n- ');
    s = s.replace(/<(br|\/p|\/div|\/h[1-6]|\/ul|\/ol|\/tr)[^>]*>/gi, '\n');
    s = s.replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s);
    s = s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
}

export function normalizeJobType(raw) {
    const t = String(raw ?? '').toLowerCase().replace(/[_\s]+/g, '-').trim();
    if (!t) return 'other';
    if (t.includes('full')) return 'full-time';
    if (t.includes('part')) return 'part-time';
    if (t.includes('contract')) return 'contract';
    if (t.includes('freelance')) return 'freelance';
    if (t.includes('intern')) return 'internship';
    return 'other';
}

const MONEY = /(?:(USD|EUR|GBP|CAD|AUD|CHF|INR|\$|€|£)\s*)?(\d[\d,]*(?:\.\d+)?)\s*([kK])?/g;

/** Best-effort parse of free text such as "$3.5k-$5k/month" or "EUR 50,000 - 60,000 per year". */
export function parseSalaryText(text) {
    const empty = { min: null, max: null, currency: null, period: null };
    if (!text || typeof text !== 'string') return empty;
    const nums = [];
    let currency = null;
    for (const m of text.matchAll(MONEY)) {
        let value = parseFloat(m[2].replace(/,/g, ''));
        if (!Number.isFinite(value)) continue;
        if (m[3]) value *= 1000;
        if (m[1] && !currency) currency = { '$': 'USD', '€': 'EUR', '£': 'GBP' }[m[1]] ?? m[1].toUpperCase();
        nums.push(value);
    }
    if (!nums.length) return empty;
    const lower = text.toLowerCase();
    let period = null;
    if (/(hour|\/hr|\bhr\b)/.test(lower)) period = 'hourly';
    else if (/week/.test(lower)) period = 'weekly';
    else if (/month|\/mo\b/.test(lower)) period = 'monthly';
    else if (/(year|annual|\/yr|\byr\b|\bpa\b)/.test(lower)) period = 'yearly';
    else if (Math.max(...nums) >= 10000) period = 'yearly';
    const min = Math.min(...nums.slice(0, 2));
    const max = nums.length > 1 ? Math.max(...nums.slice(0, 2)) : min;
    return { min, max, currency: currency ?? (text.includes('$') ? 'USD' : null), period };
}

const normPeriod = (p) => {
    const v = String(p ?? '').toLowerCase();
    if (v.startsWith('year') || v === 'annual') return 'yearly';
    if (v.startsWith('month')) return 'monthly';
    if (v.startsWith('week')) return 'weekly';
    if (v.startsWith('hour')) return 'hourly';
    return v || null;
};

const isoOrNull = (value, assumeUtc = false) => {
    if (!value) return null;
    let v = String(value);
    if (assumeUtc && !/[zZ]|[+-]\d\d:?\d\d$/.test(v)) v += 'Z';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const isWorldwide = (loc) => /(anywhere|worldwide|global|world wide)/i.test(loc ?? '');

export function normalizeJobicy(raw) {
    const industries = Array.isArray(raw.jobIndustry) ? raw.jobIndustry : raw.jobIndustry ? [raw.jobIndustry] : [];
    const types = (Array.isArray(raw.jobType) ? raw.jobType : [raw.jobType]).filter(Boolean).map(normalizeJobType);
    const hasSalary = raw.salaryMin != null || raw.salaryMax != null;
    return {
        id: `jobicy:${raw.id}`,
        source: 'jobicy',
        sourceUrl: raw.url,
        title: decodeEntities(raw.jobTitle ?? '').trim(),
        company: decodeEntities(raw.companyName ?? '').trim(),
        companyLogo: raw.companyLogo || null,
        location: raw.jobGeo || null,
        worldwide: isWorldwide(raw.jobGeo),
        jobTypes: [...new Set(types)],
        categories: industries.map((c) => decodeEntities(c)),
        tags: [],
        seniority: raw.jobLevel && raw.jobLevel !== 'Any' ? raw.jobLevel : null,
        salaryMin: hasSalary ? raw.salaryMin ?? null : null,
        salaryMax: hasSalary ? raw.salaryMax ?? null : null,
        salaryCurrency: hasSalary ? raw.salaryCurrency ?? null : null,
        salaryPeriod: hasSalary ? normPeriod(raw.salaryPeriod) : null,
        salaryText: null,
        publishedAt: isoOrNull(raw.pubDate),
        descriptionHtml: raw.jobDescription || '',
        excerpt: htmlToText(raw.jobExcerpt || ''),
    };
}

export function normalizeRemotive(raw) {
    const sal = parseSalaryText(raw.salary);
    const hasSalary = sal.min != null;
    return {
        id: `remotive:${raw.id}`,
        source: 'remotive',
        sourceUrl: raw.url,
        title: decodeEntities(raw.title ?? '').trim(),
        company: decodeEntities(raw.company_name ?? '').trim(),
        companyLogo: raw.company_logo || null,
        location: raw.candidate_required_location || null,
        worldwide: isWorldwide(raw.candidate_required_location),
        jobTypes: [normalizeJobType(raw.job_type)],
        categories: raw.category ? [raw.category] : [],
        tags: (raw.tags ?? []).map((t) => String(t).trim()).filter(Boolean),
        seniority: null,
        salaryMin: hasSalary ? sal.min : null,
        salaryMax: hasSalary ? sal.max : null,
        salaryCurrency: hasSalary ? sal.currency : null,
        salaryPeriod: hasSalary ? sal.period : null,
        salaryText: raw.salary || null,
        publishedAt: isoOrNull(raw.publication_date, true),
        descriptionHtml: raw.description || '',
        excerpt: '',
    };
}

const ATTRIBUTION = {
    jobicy: 'Source: Jobicy (https://jobicy.com). Apply through the Jobicy listing URL.',
    remotive: 'Source: Remotive (https://remotive.com). Apply through the Remotive listing URL.',
};

export function toOutput(job, { includeDescription = 'text', now = new Date() } = {}) {
    const { descriptionHtml, excerpt, ...rest } = job;
    const out = { ...rest };
    if (includeDescription === 'html') out.description = descriptionHtml;
    else if (includeDescription === 'text') out.description = htmlToText(descriptionHtml) || excerpt || '';
    out.attribution = ATTRIBUTION[job.source];
    out.alsoListedOn = job.alsoListedOn ?? [];
    out.scrapedAt = now.toISOString();
    return out;
}

const lc = (s) => String(s ?? '').toLowerCase();

export function matchesFilters(job, input, now = new Date()) {
    const terms = (input.searchTerms ?? []).map(lc).filter(Boolean);
    if (terms.length) {
        const hay = lc([job.title, job.company, job.tags.join(' '), job.categories.join(' '), htmlToText(job.descriptionHtml)].join(' \n '));
        if (!terms.some((t) => hay.includes(t))) return false;
    }
    const excl = (input.excludeTerms ?? []).map(lc).filter(Boolean);
    if (excl.length) {
        const hay = lc(`${job.title} ${job.company}`);
        if (excl.some((t) => hay.includes(t))) return false;
    }
    if (input.location) {
        const want = lc(input.location).trim();
        const ok = lc(job.location).includes(want) || (want === 'worldwide' && job.worldwide) || (want === 'anywhere' && job.worldwide);
        if (!ok) return false;
    }
    const cats = (input.categories ?? []).map(lc).filter(Boolean);
    if (cats.length && !job.categories.some((c) => cats.some((w) => lc(c).includes(w)))) return false;
    const types = input.jobTypes ?? [];
    if (types.length && !job.jobTypes.some((t) => types.includes(t))) return false;
    if (input.requireSalary && job.salaryMin == null && job.salaryMax == null) return false;
    if (input.postedWithinDays > 0) {
        if (!job.publishedAt) return false;
        const age = now.getTime() - new Date(job.publishedAt).getTime();
        if (age > input.postedWithinDays * 86400000) return false;
    }
    return true;
}

const key = (s) => lc(s).replace(/[^a-z0-9]+/g, '');

/** Keep one record per (company, title); list the others under alsoListedOn. Input order is preserved. */
export function dedupeJobs(jobs) {
    const seen = new Map();
    const out = [];
    for (const job of jobs) {
        const k = `${key(job.company)}|${key(job.title)}`;
        if (!key(job.company) || !key(job.title)) { out.push(job); continue; }
        const prev = seen.get(k);
        if (!prev) {
            const copy = { ...job, alsoListedOn: [] };
            seen.set(k, copy);
            out.push(copy);
        } else if (prev.id !== job.id) {
            prev.alsoListedOn.push({ source: job.source, sourceUrl: job.sourceUrl });
            if (prev.salaryMin == null && job.salaryMin != null) {
                Object.assign(prev, { salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, salaryPeriod: job.salaryPeriod, salaryText: job.salaryText });
            }
        }
    }
    return out;
}

export function sortNewestFirst(jobs) {
    return [...jobs].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** Returns { input, errors }. Fills defaults; never throws. */
export function validateInput(raw = {}) {
    const errors = [];
    const input = {
        sources: raw.sources?.length ? raw.sources : [...SOURCES],
        searchTerms: raw.searchTerms ?? [],
        excludeTerms: raw.excludeTerms ?? [],
        location: (raw.location ?? '').trim(),
        categories: raw.categories ?? [],
        jobTypes: raw.jobTypes ?? [],
        requireSalary: Boolean(raw.requireSalary),
        postedWithinDays: raw.postedWithinDays ?? 7,
        maxItems: raw.maxItems ?? 50,
        includeDescription: raw.includeDescription ?? 'text',
        dedupe: raw.dedupe ?? true,
    };
    for (const s of input.sources) if (!SOURCES.includes(s)) errors.push(`Unknown source "${s}". Allowed: ${SOURCES.join(', ')}.`);
    for (const t of input.jobTypes) if (!JOB_TYPES.includes(t)) errors.push(`Unknown job type "${t}". Allowed: ${JOB_TYPES.join(', ')}.`);
    if (!Number.isInteger(input.maxItems) || input.maxItems < 1 || input.maxItems > 1000) errors.push('maxItems must be an integer between 1 and 1000.');
    if (!Number.isInteger(input.postedWithinDays) || input.postedWithinDays < 0 || input.postedWithinDays > 365) errors.push('postedWithinDays must be an integer between 0 and 365 (0 = no limit).');
    if (!['text', 'html', 'none'].includes(input.includeDescription)) errors.push('includeDescription must be text, html or none.');
    for (const k of ['searchTerms', 'excludeTerms', 'categories']) if (!Array.isArray(input[k]) || input[k].some((v) => typeof v !== 'string')) errors.push(`${k} must be an array of strings.`);
    return { input, errors };
}
