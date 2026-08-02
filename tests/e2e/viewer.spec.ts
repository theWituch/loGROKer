import { expect, test } from '@playwright/test';

test('shows paths, status, and parsed columns', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LoGROKer' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: 'log.log' })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: 'config.yml' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'lines' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'timestamp' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'message' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'raw' })).toBeHidden();
  await expect.poll(async () => {
    const message = await page.getByRole('columnheader', { name: 'message' }).boundingBox();
    const viewport = await page.locator('.table-scroll').boundingBox();
    if (!message || !viewport) return Number.POSITIVE_INFINITY;
    return Math.abs(
      viewport.x + viewport.width - (message.x + message.width),
    );
  }).toBeLessThan(2);
  await expect.poll(() => page.locator('.table-scroll').evaluate((element) => (
    element.scrollWidth - element.clientWidth
  ))).toBeLessThanOrEqual(0);
  const latestRow = page.locator('.log-table tbody tr.row-latest');
  await expect(latestRow).toHaveCount(1);
  await expect.poll(async () => {
    const latest = await latestRow.boundingBox();
    const viewport = await page.locator('.table-scroll').boundingBox();
    if (!latest || !viewport) return Number.POSITIVE_INFINITY;
    return Math.abs(
      viewport.y + viewport.height - (latest.y + latest.height),
    );
  }).toBeLessThan(2);
  await expect.poll(async () => (
    (await latestRow.boundingBox())?.height ?? 0
  )).toBeGreaterThanOrEqual(180);
  await expect.poll(() => page.locator('.table-scroll').evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeLessThanOrEqual(1);

  await page.getByRole('checkbox', { name: 'Blokuj najnowszy' }).check();
  await expect(latestRow).toHaveClass(/row-pinned/);
  await page.locator('.table-scroll').evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('.table-scroll').evaluate((element) => (
    element.scrollTop
  ))).toBe(0);
  await expect(latestRow).toBeVisible();
  await expect.poll(async () => {
    const latest = await latestRow.boundingBox();
    const viewport = await page.locator('.table-scroll').boundingBox();
    if (!latest || !viewport) return Number.POSITIVE_INFINITY;
    return Math.abs(
      viewport.y + viewport.height - (latest.y + latest.height),
    );
  }).toBeLessThan(2);

  const firstRow = page.locator('.log-table tbody tr').filter({ hasText: 'Test message 01' });
  const fifthRow = page.locator('.log-table tbody tr').filter({ hasText: 'Test message 05' });
  const tenthRow = page.locator('.log-table tbody tr').filter({ hasText: 'Test message 10' });
  await firstRow.click();
  await expect(firstRow).toHaveClass(/row-selected/);
  await fifthRow.click({ modifiers: ['Shift'] });
  await expect(page.locator('.log-table tbody tr.row-selected')).toHaveCount(5);
  await expect(page.getByText('5 selected', { exact: true })).toBeVisible();
  await tenthRow.click();
  await expect(page.locator('.log-table tbody tr.row-selected')).toHaveCount(1);
  await expect(tenthRow).toHaveClass(/row-selected/);
  await firstRow.click({ modifiers: ['Control'] });
  await fifthRow.click({ modifiers: ['Control'] });
  await expect(page.locator('.log-table tbody tr.row-selected')).toHaveCount(3);
  await expect(firstRow).toHaveClass(/row-selected/);
  await expect(fifthRow).toHaveClass(/row-selected/);
  await expect(tenthRow).toHaveClass(/row-selected/);
  await fifthRow.click({ modifiers: ['Control'] });
  await expect(page.locator('.log-table tbody tr.row-selected')).toHaveCount(2);
  await expect(fifthRow).not.toHaveClass(/row-selected/);

  const multilineBadge = page.getByRole('button', { name: '14 lines' });
  await expect(multilineBadge.locator('xpath=ancestor::td')).toHaveClass(/cell-multiline/);
  await multilineBadge.click();
  const details = page.getByRole('dialog', { name: 'Log record details' });
  await expect(details).toBeVisible();
  await expect(details.locator('pre')).toContainText('RuntimeError: Telegram down');
  await expect(details.getByRole('button', { name: 'Copy' })).toBeVisible();
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(details).toBeHidden();

  await page.screenshot({ path: 'test-results/viewer.png', fullPage: true });
});
