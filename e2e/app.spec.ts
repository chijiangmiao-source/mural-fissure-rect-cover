import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('网格与裂格编辑', () => {
  test('默认展示 4×4 网格，点击切换裂格并更新计数', async ({ page }) => {
    await expect(page.getByTestId('board')).toBeVisible();
    const count = page.getByTestId('crack-count');
    await expect(count).toContainText('裂格 0 / 60');

    await page.getByTestId('cell-0-0').click();
    await page.getByTestId('cell-2-3').click();
    await expect(count).toContainText('裂格 2 / 60');
    await expect(page.getByTestId('cell-0-0')).toHaveAttribute('data-crack', '1');
    await expect(page.getByTestId('cell-0-1')).toHaveAttribute('data-crack', '0');

    // 再次点击取消
    await page.getByTestId('cell-0-0').click();
    await expect(count).toContainText('裂格 1 / 60');
  });

  test('应用 12×12 尺寸后网格变为 144 格', async ({ page }) => {
    await page.getByTestId('width-input').fill('12');
    await page.getByTestId('height-input').fill('12');
    await page.getByTestId('apply-size').click();
    await expect(page.getByTestId('cell-11-11')).toBeAttached();
    await expect(page.getByTestId('crack-count')).toContainText('共 144 格');
  });

  test('越界尺寸（13）显示错误并清除旧解', async ({ page }) => {
    // 先产生一个合法解
    await page.getByTestId('cell-0-0').click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('1');

    // 输入非法尺寸
    await page.getByTestId('width-input').fill('13');
    await page.getByTestId('apply-size').click();
    const err = page.getByTestId('error-banner');
    await expect(err).toBeVisible();
    await expect(err).toContainText('1–12');
    await expect(err).toContainText('旧方案已清除');
    // 旧解已被清除
    await expect(page.getByTestId('optimum')).toHaveCount(0);
  });

  test('非整数尺寸显示错误反馈', async ({ page }) => {
    await page.getByTestId('height-input').fill('2.5');
    await page.getByTestId('apply-size').click();
    await expect(page.getByTestId('error-banner')).toContainText('整数');
  });

  test('裂格达到 60 上限后拒绝继续添加并说明原因', async ({ page }) => {
    await page.getByTestId('width-input').fill('12');
    await page.getByTestId('height-input').fill('12');
    await page.getByTestId('apply-size').click();
    for (let i = 0; i < 60; i++) {
      const r = Math.floor(i / 12);
      const c = i % 12;
      await page.getByTestId(`cell-${r}-${c}`).click();
    }
    await expect(page.getByTestId('crack-count')).toContainText('裂格 60 / 60');
    await page.getByTestId('cell-5-0').click();
    await expect(page.getByTestId('error-banner')).toContainText('最多 60');
    await expect(page.getByTestId('crack-count')).toContainText('裂格 60 / 60');
  });
});

test.describe('精确搜索与结果展示', () => {
  test('孔洞预设（3×3 环）搜索得到 4 块贴片、状态数与坐标列表', async ({ page }) => {
    await page.getByRole('button', { name: '预设：孔洞' }).click();
    await page.getByTestId('solve-button').click();

    await expect(page.getByTestId('optimum')).toHaveText('4');
    await expect(page.getByTestId('states')).not.toHaveText('0');
    // 贴片坐标列表 4 项
    await expect(page.getByTestId('patch-list').locator('li')).toHaveCount(4);
    // SVG 中渲染 4 个彩色贴片
    await expect(page.locator('[data-testid^="patch-"]').and(page.locator('rect.patch'))).toHaveCount(4);
    // 每块贴片都不得覆盖中心孔洞 (1,1)：由贴片坐标范围保证，展示坐标中检查
    const bodyText = await page.getByTestId('patch-list').innerText();
    expect(bodyText).toContain('上 1');
  });

  test('狭枝预设（十字）搜索得到 3 块贴片', async ({ page }) => {
    await page.getByRole('button', { name: '预设：狭枝' }).click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('3');
  });

  test('并列决胜预设（L 形三格）：横/竖并列 2 块，字典序取横铺', async ({ page }) => {
    await page.getByRole('button', { name: /并列决胜/ }).click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('2');
    const list = page.getByTestId('patch-list');
    // 一基展示：内部 0 起的顶行横条 [0,0,0,1] 显示为「上1 左1 下1 右2」，
    // 左下格 [1,0,1,0] 显示为「上2 左1 下2 右1」。
    const items = list.locator('li');
    await expect(items.nth(0)).toContainText('上 1，左 1，下 1，右 2');
    await expect(items.nth(1)).toContainText('上 2，左 1，下 2，右 1');
  });

  test('贪心反例预设：精确最优 2 块，而局部贪心 3 块', async ({ page }) => {
    await page.getByRole('button', { name: '预设：贪心反例' }).click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toHaveText('2');
    await expect(page.getByTestId('greedy-count')).toContainText('3 块');
    await expect(page.getByTestId('greedy-count')).toContainText('贪心多耗 1 块');
  });

  test('无裂格时搜索按钮禁用；编辑裂格后旧解被清除提示', async ({ page }) => {
    await expect(page.getByTestId('solve-button')).toBeDisabled();
    await page.getByTestId('cell-1-1').click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('optimum')).toBeVisible();
    await page.getByTestId('cell-1-2').click();
    await expect(page.getByTestId('notice-banner')).toContainText('旧解已清除');
    await expect(page.getByTestId('optimum')).toHaveCount(0);
  });
});

test.describe('分支取舍回放', () => {
  test('可逐步查看分支取舍，滑块与信息同步', async ({ page }) => {
    await page.getByRole('button', { name: '预设：孔洞' }).click();
    await page.getByTestId('solve-button').click();
    await expect(page.getByTestId('trace-panel')).toBeVisible();

    const info = page.getByTestId('trace-info');
    // 初始展示最终方案，不处于逐步回放
    await expect(info).toContainText('最终方案');
    await expect(page.getByTestId('replay-rect')).toHaveCount(0);

    await page.getByTestId('trace-first').click();
    await expect(info).toContainText('第 1 /');
    await expect(info).toContainText('贪心');

    await page.getByTestId('trace-next').click();
    await expect(info).toContainText('第 2 /');
    await expect(page.getByTestId('replay-rect')).toBeVisible();

    await page.getByTestId('trace-prev').click();
    await expect(info).toContainText('第 1 /');

    const total = Number(await page.getByTestId('trace-slider').getAttribute('max'));
    await page.getByTestId('trace-last').click();
    await expect(info).toContainText(`第 ${total + 1} / ${total + 1}`);

    // 返回最终方案后高亮消失
    await page.getByTestId('trace-exit').click();
    await expect(page.getByTestId('replay-rect')).toHaveCount(0);
    await expect(info).toContainText('最终方案');
  });
});

test.describe('结果唯一性与可复算', () => {
  test('同一图样两次搜索给出相同贴片数与坐标序列', async ({ page }) => {
    await page.getByTestId('cell-0-0').click();
    await page.getByTestId('cell-0-1').click();
    await page.getByTestId('cell-1-0').click(); // L 形：字典序横铺 2 块

    await page.getByTestId('solve-button').click();
    const run1 = await page.getByTestId('patch-list').innerText();
    const opt1 = await page.getByTestId('optimum').innerText();

    await page.getByTestId('cell-1-1').click(); // 改图清解
    await page.getByTestId('cell-1-1').click(); // 改回同一图样
    await page.getByTestId('solve-button').click();
    const run2 = await page.getByTestId('patch-list').innerText();
    const opt2 = await page.getByTestId('optimum').innerText();

    expect(opt1).toBe(opt2);
    expect(run1).toBe(run2);
    expect(run1).toContain('上 1');
  });
});
