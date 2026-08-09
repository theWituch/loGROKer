import { expect, test } from '@playwright/test';

test('shows paths, status, and parsed columns', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'LoGROKer' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.locator('details.source-picker summary').click();
  await expect(page.locator('.source-option').filter({ hasText: 'log.log' })).toBeVisible();
  await expect(page.locator('.source-option').filter({ hasText: 'config.yml' })).toBeVisible();
  await page.locator('details.source-picker summary').click();

  const levelPicker = page.locator('details.level-picker');
  await levelPicker.locator('summary').click();
  const infoLevel = levelPicker.getByRole('checkbox', { name: 'INFO' });
  const errorLevel = levelPicker.getByRole('checkbox', { name: 'ERROR' });
  await expect(infoLevel).toBeChecked();
  await expect(errorLevel).toBeChecked();
  await expect(infoLevel.locator('xpath=following-sibling::*')).toHaveClass(/level-info/);
  await expect(errorLevel.locator('xpath=following-sibling::*')).toHaveClass(/level-error/);
  await infoLevel.uncheck();
  await expect(page.locator('.log-table tbody tr.level-info')).toHaveCount(0);
  await expect(page.locator('.log-table tbody tr.level-error')).toHaveCount(1);

  await page.reload();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.locator('details.level-picker summary').click();
  await expect(page.locator('details.level-picker').getByRole('checkbox', { name: 'INFO' })).not.toBeChecked();
  await page.locator('details.level-picker').getByRole('button', { name: 'Show all' }).click();
  await expect(page.locator('details.level-picker').getByRole('checkbox', { name: 'INFO' })).toBeChecked();
  await page.locator('details.level-picker summary').click();

  const search = page.getByRole('textbox', { name: 'Szukaj w logach' });
  await search.fill('level:ERROR AND NOT message:timeout');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.log-table tbody tr')).toContainText('Could not send notification');
  await search.fill('message:/Telegram/i');
  await expect(page.getByRole('alert')).toContainText('Regular expressions');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(0);
  await expect(page.getByText('Fix the search query.')).toBeVisible();
  await search.fill('message:Telegram*');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  await search.fill('');

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

  await page.getByRole('checkbox', { name: 'Lock newest' }).check();
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
  await expect(details.getByRole('heading', { name: 'Raw log' })).toBeVisible();
  await expect(details.locator('pre')).toContainText('RuntimeError: Telegram down');
  await expect(details.locator('pre')).toHaveCSS('white-space', 'pre-wrap');
  await expect(details.locator('pre')).toHaveCSS('overflow-wrap', 'anywhere');
  await expect(details.getByRole('button', { name: 'Copy' })).toBeVisible();
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(details).toBeHidden();

  await page.screenshot({ path: 'test-results/viewer.png', fullPage: true });
});

test('reorders columns from the picker and persists or resets the order', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const headerNames = () => page.getByRole('columnheader').allTextContents()
    .then((values) => values.map((value) => value.trim()));
  const initialHeaders = await headerNames();
  expect(initialHeaders[0]).toBe('timestamp');

  const picker = page.locator('details.column-order-picker');
  await picker.locator('summary').click();
  const messageOption = picker.locator('[data-column-id="message"]');
  const timestampOption = picker.locator('[data-column-id="timestamp"]');
  await messageOption.getByRole('checkbox').uncheck();
  await messageOption.getByRole('button', { name: 'Move column message' }).dragTo(
    timestampOption,
    { targetPosition: { x: 12, y: 2 } },
  );
  await messageOption.getByRole('checkbox').check();
  await expect.poll(headerNames).toEqual([
    'message',
    ...initialHeaders.filter((header) => header !== 'message'),
  ]);

  await page.reload();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect.poll(headerNames).toEqual([
    'message',
    ...initialHeaders.filter((header) => header !== 'message'),
  ]);

  await picker.locator('summary').click();
  await picker.getByRole('button', { name: 'Reset order' }).click();
  await expect.poll(headerNames).toEqual(initialHeaders);
  await expect.poll(() => page.evaluate(() => (
    localStorage.getItem('logroker.columnOrder.v1')
  ))).toBeNull();

  await picker.locator('[data-column-id="level"]')
    .getByRole('button', { name: 'Move column level' })
    .press('ArrowUp');
  await expect.poll(headerNames).toEqual([
    'level',
    'timestamp',
    ...initialHeaders.slice(2),
  ]);
  await picker.getByRole('button', { name: 'Reset order' }).click();
  await expect.poll(headerNames).toEqual(initialHeaders);
});

test('restores the query from storage or URL and navigates query history', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('logroker.searchQuery.v1', 'level:INFO');
  });
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const search = page.getByRole('textbox', { name: 'Szukaj w logach' });
  await expect(search).toHaveValue('level:INFO');
  await expect.poll(() => page.evaluate(() => (
    new URL(window.location.href).searchParams.get('q')
  ))).toBe('level:INFO');

  await page.goto('/?q=level%3AERROR');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('level:ERROR');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (
    localStorage.getItem('logroker.searchQuery.v1')
  ))).toBe('level:ERROR');

  await search.fill('level:INFO');
  await search.press('Enter');
  await expect(search).toHaveValue('level:INFO');
  await page.goBack();
  await expect(search).toHaveValue('level:ERROR');
  await page.goForward();
  await expect(search).toHaveValue('level:INFO');

  await page.reload();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('level:INFO');

  await page.goto('/?q=');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('');
  await expect.poll(() => page.evaluate(() => (
    localStorage.getItem('logroker.searchQuery.v1')
  ))).toBeNull();
});

test('adds include and exclude filters from hovered cells', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  const search = page.getByRole('textbox', { name: 'Szukaj w logach' });
  const errorRow = page.locator('.log-table tbody tr')
    .filter({ hasText: 'Could not send notification' });
  const errorLevelCell = errorRow.locator('td[data-field="level"]');
  const includeError = errorLevelCell.getByRole('button', {
    name: 'Require level: ERROR',
  });
  await expect(includeError).toBeAttached();
  await expect(includeError.locator('xpath=..')).toHaveCSS('opacity', '0');
  await errorLevelCell.hover();
  await expect(includeError.locator('xpath=..')).toHaveCSS('opacity', '1');
  await includeError.click();

  await expect(search).toHaveValue('"level":"ERROR"');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.log-table tbody tr.row-selected')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    new URL(window.location.href).searchParams.get('q')
  ))).toBe('"level":"ERROR"');

  await page.getByTitle('Clear').click();
  await expect(search).toHaveValue('');
  await expect.poll(() => page.locator('.log-table tbody tr').count())
    .toBeGreaterThan(1);

  const infoRow = page.locator('.log-table tbody tr').filter({ hasText: 'Test message 01' });
  const infoLevelCell = infoRow.locator('td[data-field="level"]');
  await infoLevelCell.hover();
  await infoLevelCell.getByRole('button', { name: 'Exclude level: INFO' }).click();
  await expect(search).toHaveValue('NOT "level":"INFO"');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);
  await expect(errorRow).toBeVisible();

  await page.goBack();
  await expect(search).toHaveValue('');
  await expect.poll(() => page.locator('.log-table tbody tr').count())
    .toBeGreaterThan(1);
  await page.goForward();
  await expect(search).toHaveValue('NOT "level":"INFO"');
  await expect(page.locator('.log-table tbody tr')).toHaveCount(1);

  const multilineMessage = errorRow.locator('td[data-field="message"]');
  await expect(multilineMessage.getByRole('button', { name: /message:/ })).toHaveCount(0);
  await expect(multilineMessage.getByRole('button', { name: '14 lines' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(search).toHaveValue('NOT "level":"INFO"');
});
