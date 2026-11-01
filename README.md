# Remote Jobs Feed: Jobicy + Remotive, filtered and deduplicated

Reads the free public remote-job feeds of **Jobicy** and **Remotive**, normalises them into one schema, applies your filters, merges duplicates and saves the newest matches to a dataset. It calls only the two providers' public JSON APIs. It does not scrape web pages, log in, or collect any personal data (rows describe job postings and companies only).

## What you get

- One row per job with title, company, location restriction, job type, categories, tags, salary fields, publish time, a plain-text or HTML description and a link back to the listing on its source.
- Filters that work the same on both sources: keywords (any match), excluded words, location text, categories, job types, "has a salary", posted within N days.
- Cross-source duplicate merging (same company and title): one row, with the other listing URL under `alsoListedOn`.
- A `SUMMARY` record in the key-value store showing, per source, how many jobs were fetched and matched and whether the source failed. One failing source never fails the run; the other source's jobs are still saved.

## Sources and attribution (please read)

| Source | What it provides | Terms that apply to you |
|---|---|---|
| Jobicy (`jobicy.com/api/jobs`) | The most recent 7 days of remote jobs, usually the large majority of results | Reuse and aggregation are allowed. Credit Jobicy and keep applicants pointed at the Jobicy listing URL (`sourceUrl`). |
| Remotive (`remotive.com/api/remote-jobs`) | Remotive's public feed, delayed 24 hours. At the time of writing it contains only a few dozen jobs (13 in the last check), so expect it to add a small share | Link back to the Remotive listing and name Remotive as the source. Do not submit Remotive jobs to other job sites (for example Google Jobs, LinkedIn Jobs, Jooble) and do not use them to collect sign-ups. Remotive asks API users to fetch at most about 4 times a day; heavy scheduling may get requests blocked, in which case the run reports the source as failed. |

Every output row carries an `attribution` line and the original listing URL. This Actor is not affiliated with Jobicy or Remotive.

## Input

| Field | Type | Default | Meaning |
|---|---|---|---|
| `sources` | array | both | `jobicy`, `remotive` |
| `searchTerms` | array of strings | none | Keep jobs whose title, company, tags, category or description contains ANY term |
| `excludeTerms` | array of strings | none | Drop jobs whose title or company contains ANY term |
| `location` | string | none | Text match on the location restriction, e.g. `USA`, `Europe`; `Worldwide` keeps jobs open to applicants anywhere |
| `categories` | array of strings | none | Match category or industry text, e.g. `engineering` |
| `jobTypes` | array | none | `full-time`, `part-time`, `contract`, `freelance`, `internship`, `other` |
| `requireSalary` | boolean | false | Only postings that state a salary |
| `postedWithinDays` | integer | 7 | 0 = no limit. Jobicy only serves 7 days |
| `maxItems` | integer | 50 | 1 to 1000. Caps the rows saved and therefore the cost |
| `includeDescription` | string | `text` | `text`, `html` or `none` |
| `dedupe` | boolean | true | Merge same company + title across sources |

Invalid input stops the run immediately with a message that lists every problem.

Example input:

```json
{
  "searchTerms": ["python", "data"],
  "jobTypes": ["full-time"],
  "requireSalary": true,
  "maxItems": 25
}
```

## Output

Example row (real output from a test run, description omitted here for length):

```json
{
  "id": "jobicy:158260",
  "source": "jobicy",
  "sourceUrl": "https://jobicy.com/jobs/158260-full-stack-engineer-ai-platform",
  "title": "Full-Stack Engineer, AI Platform",
  "company": "Thumbtack",
  "companyLogo": "https://jobicy.com/data/server-nyc0409/galaxy/mercury/2021/05/Jobicy-210503180426-842530.jpg",
  "location": "USA",
  "worldwide": false,
  "jobTypes": [
    "full-time"
  ],
  "categories": [
    "Software Engineering"
  ],
  "tags": [],
  "seniority": null,
  "salaryMin": 151300,
  "salaryMax": 229900,
  "salaryCurrency": "USD",
  "salaryPeriod": "yearly",
  "salaryText": null,
  "publishedAt": "2026-10-31T17:05:04.000Z",
  "alsoListedOn": [],
  "attribution": "Source: Jobicy (https://jobicy.com). Apply through the Jobicy listing URL.",
  "scrapedAt": "2026-11-01T02:46:28.116Z"
}
```

Salary notes: Jobicy supplies numeric salary fields. Remotive supplies free text such as `$3.5k-$5k/month`; the Actor parses it on a best-effort basis into `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod` and always keeps the original in `salaryText`. Check `salaryText` before relying on a parsed Remotive figure.

## Pricing

Pay per event:

- **Actor start**: $0.00005 (Apify standard synthetic event).
- **Job listing**: $0.002 per saved row (that is $2 per 1,000 jobs).

You are charged only for rows saved to the dataset. Set `maxItems` to cap spend; the platform's maximum-cost-per-run setting is also respected and the run stops cleanly when it is reached. A run that matches nothing costs only the start event.

Example: 100 Python jobs with salary = about $0.20.

## Limits and honest caveats

- Coverage is whatever the two public feeds expose. It is not every remote job on the internet and not a replacement for a full job-board crawl.
- Jobicy's feed covers the last 7 days only. Remotive's feed is delayed by a day.
- Salary parsing for Remotive is heuristic. Posting text is passed through as published; descriptions can contain the employer's own formatting or HTML.
- If a source changes its API or blocks requests, that source fails and is reported in `SUMMARY` and in the run's status message; the Actor keeps going with the other source.

## Use it from code

```bash
curl -X POST "https://api.apify.com/v2/acts/rishabhcli~remote-jobs-feed/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"searchTerms":["python"],"maxItems":10}'
```

## Source code

MIT licensed. Source and tests are on GitHub under rishabhcli/apify-remote-jobs-feed. Run the unit tests with `npm test`.
