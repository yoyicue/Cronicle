const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { labs, api, admin, eventFixture } = require('./helpers.cjs');
test('T12 I32 real minute boundary triggers exactly one harmless job in each independent backend', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'The original backend scheduler has no browser-specific execution path.');
  test.setTimeout(100000);
  const epoch = (Math.floor((Date.now() + 5000) / 60000) + 1) * 60;
  const when = new Date(epoch * 1000), id = 'actualminute';
  const results = [];
  const sessions = [];
  try {
    for (const lab of labs()) {
      const session = await admin(lab); sessions.push({ lab, session });
      const result = await api(lab, 'app/create_event', eventFixture(id, { enabled: 1, timezone: 'UTC', timing: { years: [when.getUTCFullYear()], months: [when.getUTCMonth() + 1], days: [when.getUTCDate()], hours: [when.getUTCHours()], minutes: [when.getUTCMinutes()] } }), session);
      expect(result.code).toBe(0);
    }
    for (const { lab, session } of sessions) {
      let history;
      await expect.poll(async () => {
        history = await api(lab, 'app/get_event_history', { id, offset: 0, limit: 20 }, session);
        return (history.rows || []).length;
      }, { timeout: 75000, intervals: [200, 500, 1000] }).toBe(1);
      const details = await api(lab, 'app/get_job_details', { id: history.rows[0].id }, session);
      expect(details.job.code).toBe(0);
      expect(details.job.now).toBe(epoch);
      expect(details.job.source).toBeUndefined();
      results.push({ locale: lab.locale, now: details.job.now, code: details.job.code, count: history.rows.length, event: details.job.event });
    }
    fs.writeFileSync('out/minute.json', JSON.stringify({ targetEpoch: epoch, results }, null, 2));
  }
  finally { for (const { lab, session } of sessions) await api(lab, 'app/update_event', { id, enabled: 0 }, session); }
});
