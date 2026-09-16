import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function clickCells(page: Page, cells: Array<[number, number]>) {
  for (const [r, c] of cells) {
    await page.getByTestId(`cell-${r}-${c}`).click();
  }
}

/** 2×2 全裂 → 搜索 → 标记为已安装基线（基线 = 1 块 [上1,左1,下2,右2]） */
async function installBaseline2x2(page: Page) {
  await clickCells(page, [[0, 0], [0, 1], [1, 0], [1, 1]]);
  await page.getByTestId('solve-button').click();
  await expect(page.getByTestId('optimum')).toHaveText('1');
  await page.getByTestId('mark-baseline').click();
  await expect(page.getByTestId('baseline-info')).toContainText('1 块贴片');
}

test.describe('基线建立与反馈', () => {
  test('未建立基线：说明原因、不可生成改造方案；原精确搜索不受影响', async ({ page }) => {
    const hint = page.getByTestId('baseline-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('尚未建立已安装基线');
    await expect(page.getByTestId('renovate-button')).toBeDisabled();
    await expect(page.getByTestId('mark-baseline')).toBeDisabled();
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);

    // 原「开始精确搜索」流程不受影响
    await clickCells(page, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('1');
    await expect(page.getByTestId('patch-list').locator('li')).toHaveCount(1);
    // 仍未建立基线，不得出现改造结果
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);
    // 搜索完成后可以标记基线
    await expect(page.getByTestId('mark-baseline')).toBeEnabled();
  });

  test('尺寸改变明确清除不再兼容的基线并说明原因', async ({ page }) => {
    await installBaseline2x2(page);
    await expect(page.getByTestId('baseline-info')).toBeVisible();

    await page.getByTestId('width-input').fill('5');
    await page.getByTestId('apply-size').click();
    const notice = page.getByTestId('notice-banner');
    await expect(notice).toContainText('基线');
    await expect(notice).toContainText('不兼容');
    await expect(notice).toContainText('清除');
    // 基线被清除，回到未建立状态
    await expect(page.getByTestId('baseline-hint')).toBeVisible();
    await expect(page.getByTestId('renovate-button')).toBeDisabled();
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);
  });

  test('同尺寸编辑裂格：只清除过期结果，基线保留', async ({ page }) => {
    await installBaseline2x2(page);
    await page.getByTestId('cell-2-2').click(); // 扩展一格
    const notice = page.getByTestId('notice-banner');
    await expect(notice).toContainText('基线保留');
    // 旧解被清除，基线仍在
    await expect(page.getByTestId('optimum')).toHaveCount(0);
    await expect(page.getByTestId('baseline-info')).toBeVisible();
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);
    await expect(page.getByTestId('renovate-button')).toBeEnabled();
  });
});

test.describe('改造方案：扩展 / 愈合 / 无变化', () => {
  test('扩展场景：保留基线块 + 新增 1 块，图层与操作清单一致', async ({ page }) => {
    await installBaseline2x2(page);
    // 扩展：新增裂格 (0,2)
    await page.getByTestId('cell-0-2').click();
    await expect(page.getByTestId('optimum')).toHaveCount(0); // 旧解已清除

    await page.getByTestId('renovate-button').click();
    await expect(page.getByTestId('renovation-stats')).toBeVisible();
    await expect(page.getByTestId('renovation-kept-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-removed-count')).toHaveText('0');
    await expect(page.getByTestId('renovation-added-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-operations')).toHaveText('1');
    await expect(page.getByTestId('renovation-final-count')).toHaveText('2');

    // SVG 图层：1 保留 + 1 新增 + 0 拆除
    await expect(page.getByTestId('renov-kept-0')).toBeVisible();
    await expect(page.getByTestId('renov-added-0')).toBeVisible();
    await expect(page.locator('[data-testid^="renov-removed-"]')).toHaveCount(0);
    await expect(page.getByTestId('renovation-legend')).toBeVisible();

    // 操作清单坐标可复算（一基坐标）
    await expect(page.getByTestId('kept-list')).toContainText('上 1，左 1，下 2，右 2');
    await expect(page.getByTestId('added-list')).toContainText('上 1，左 3，下 1，右 3');
    await expect(page.getByTestId('removed-empty')).toBeVisible();
  });

  test('愈合场景：拆除失效基线块并重新覆盖，图层与操作清单一致', async ({ page }) => {
    await installBaseline2x2(page);
    // 愈合：取消裂格 (1,1)，基线块压到完好格必须拆除
    await page.getByTestId('cell-1-1').click();

    await page.getByTestId('renovate-button').click();
    await expect(page.getByTestId('renovation-kept-count')).toHaveText('0');
    await expect(page.getByTestId('renovation-removed-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-added-count')).toHaveText('2');
    await expect(page.getByTestId('renovation-operations')).toHaveText('3');

    // SVG 图层：0 保留 + 2 新增 + 1 拆除
    await expect(page.locator('[data-testid^="renov-kept-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="renov-added-"]')).toHaveCount(2);
    await expect(page.getByTestId('renov-removed-0')).toBeVisible();

    // 操作清单：拆除的是原基线块（上1,左1,下2,右2）
    await expect(page.getByTestId('removed-list')).toContainText('上 1，左 1，下 2，右 2');
    await expect(page.getByTestId('kept-empty')).toBeVisible();
    await expect(page.getByTestId('added-list').locator('li')).toHaveCount(2);
  });

  test('无变化场景：全部保留、0 操作，且原搜索结果不受影响', async ({ page }) => {
    await installBaseline2x2(page);
    // 不编辑裂格，直接生成改造方案
    await page.getByTestId('renovate-button').click();
    await expect(page.getByTestId('renovation-operations')).toHaveText('0');
    await expect(page.getByTestId('renovation-kept-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-removed-count')).toHaveText('0');
    await expect(page.getByTestId('renovation-added-count')).toHaveText('0');
    await expect(page.locator('[data-testid^="renov-kept-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="renov-added-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="renov-removed-"]')).toHaveCount(0);

    // 原搜索结果不受影响：最优解统计与贴片清单仍在
    await expect(page.getByTestId('optimum')).toHaveText('1');
    await expect(page.getByTestId('patch-list').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('patch-list')).toContainText('上 1，左 1，下 2，右 2');

    // 原「开始精确搜索」流程保持可用：再次搜索给出相同结果
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('1');
    await expect(page.getByTestId('patch-list').locator('li')).toHaveCount(1);
    // 新搜索取代改造视图
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);
  });

  test('扩展后再愈合：基线跨多次编辑保留，改造结果随当前裂格更新', async ({ page }) => {
    await installBaseline2x2(page);
    await page.getByTestId('cell-0-2').click(); // 扩展
    await page.getByTestId('renovate-button').click();
    await expect(page.getByTestId('renovation-operations')).toHaveText('1');

    // 再编辑：刚新增的裂格愈合 → 回到原图样，改造结果过期被清除
    await page.getByTestId('cell-0-2').click();
    await expect(page.getByTestId('renovation-panel')).toHaveCount(0);
    await expect(page.getByTestId('baseline-info')).toBeVisible();

    // 重新生成：与基线一致 → 0 操作
    await page.getByTestId('renovate-button').click();
    await expect(page.getByTestId('renovation-operations')).toHaveText('0');
    await expect(page.getByTestId('renovation-kept-count')).toHaveText('1');
  });
});

test.describe('Worker 失败的同步回退', () => {
  test('Worker 脚本不可用时，同步回退仍按相同目标生成改造方案与搜索结果', async ({ page }) => {
    // 拦截 Worker 脚本请求，强制走同步回退路径
    await page.route('**/*Worker*', (route) => route.abort());

    await clickCells(page, [[0, 0], [0, 1], [1, 0], [1, 1]]);
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('1'); // 搜索同步回退仍可用
    await page.getByTestId('mark-baseline').click();

    await page.getByTestId('cell-0-2').click(); // 扩展
    await page.getByTestId('renovate-button').click();
    // 同步回退执行相同目标：保留 1 + 新增 1
    await expect(page.getByTestId('renovation-kept-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-added-count')).toHaveText('1');
    await expect(page.getByTestId('renovation-operations')).toHaveText('1');
    await expect(page.getByTestId('renov-kept-0')).toBeVisible();
    await expect(page.getByTestId('renov-added-0')).toBeVisible();
  });
});
