import { describe, it, expect, vi } from 'vitest';
import { waitForSettled } from './doc-extractor';

const fakePage = (failures: number) => {
  let calls = 0;
  return {
    calls: () => calls,
    waitForFunction: vi.fn(async () => {
      calls++;
      if (calls <= failures) throw new Error('timeout');
    }),
    waitForTimeout: vi.fn(async () => {}),
  };
};

describe('waitForSettled', () => {
  it('checks twice with a pause between, so a skeleton about to be replaced is not missed', async () => {
    const page = fakePage(0);
    await waitForSettled(page, 10);
    expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledWith(300);
  });
  it('does not throw when the page never settles', async () => {
    await expect(waitForSettled(fakePage(99), 10)).resolves.toBeUndefined();
  });
});

import { stableBox } from './doc-extractor';
describe('stableBox', () => {
  const box = (y: number) => ({ x: 5, y, width: 100, height: 20 });
  it('returns the box once it has stopped moving, not the first one measured', async () => {
    const ys = [100, 100, 220, 220, 220, 220, 220, 220];
    let i = 0;
    const locator = { boundingBox: vi.fn(async () => box(ys[Math.min(i++, ys.length - 1)])) };
    const page = { waitForTimeout: vi.fn(async () => {}) };
    const got = await stableBox(locator, page, 1, 2000);
    expect(got?.y).toBe(220);
  });
  it('returns null at once for a hidden element', async () => {
    const locator = { boundingBox: vi.fn(async () => null) };
    expect(await stableBox(locator, { waitForTimeout: async () => {} }, 1, 2000)).toBeNull();
  });
});
