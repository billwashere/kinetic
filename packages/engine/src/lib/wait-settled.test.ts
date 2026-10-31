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
