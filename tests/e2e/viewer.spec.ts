import { expect, test } from '@playwright/test';

test('shows paths, status, and GROK columns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LoGROKer' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: 'log.log' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'lines' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'timestamp' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'message' })).toBeVisible();

  await page.getByRole('button', { name: '14 lines' }).click();
  const details = page.getByRole('dialog', { name: 'Log record details' });
  await expect(details).toBeVisible();
  await expect(details.locator('pre')).toContainText('RuntimeError: Telegram down');
  await expect(details.getByRole('button', { name: 'Copy' })).toBeVisible();
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(details).toBeHidden();

  await page.screenshot({ path: 'test-results/viewer.png', fullPage: true });
});
