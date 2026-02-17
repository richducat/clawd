import test from 'node:test';
import assert from 'node:assert/strict';

import { inDailyWindow, inQuietHours } from './sms-autopilot.mjs';

const TZ = 'America/Los_Angeles';

test('evening window includes 20:29 and excludes 20:30 (PT)', () => {
  const window = { start: { hour: 16, minute: 0 }, end: { hour: 20, minute: 30 } };

  assert.equal(
    inDailyWindow({ date: new Date('2026-02-17T04:29:00.000Z'), timeZone: TZ, window }),
    true,
    '20:29 PT should be inside evening window',
  );

  assert.equal(
    inDailyWindow({ date: new Date('2026-02-17T04:30:00.000Z'), timeZone: TZ, window }),
    false,
    '20:30 PT should be outside evening window',
  );
});

test('quiet hours wrap midnight: 21:00–08:00 (PT)', () => {
  const quietStart = { hour: 21, minute: 0 };
  const quietEnd = { hour: 8, minute: 0 };

  assert.equal(
    inQuietHours({ date: new Date('2026-02-17T05:00:00.000Z'), timeZone: TZ, quietStart, quietEnd }),
    true,
    '21:00 PT should be quiet',
  );

  assert.equal(
    inQuietHours({ date: new Date('2026-02-17T15:59:00.000Z'), timeZone: TZ, quietStart, quietEnd }),
    true,
    '07:59 PT should be quiet',
  );

  assert.equal(
    inQuietHours({ date: new Date('2026-02-17T16:00:00.000Z'), timeZone: TZ, quietStart, quietEnd }),
    false,
    '08:00 PT should not be quiet',
  );
});
