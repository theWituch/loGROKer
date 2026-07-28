import { expect, test } from '@playwright/test';

test('shows paths, status, and GROK columns', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LoGROKer' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: 'log.log' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'timestamp' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'message' })).toBeVisible();
  await page.screenshot({ path: 'test-results/viewer.png', fullPage: true });
});
