// Проверка фильтра на упрощённой модели ленты (test/mock.html).
// Запуск: node test/filter.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const script = fs.readFileSync(path.join(__dirname, '../filter/minigram.user.js'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, 'mock.html'), 'utf8');

const visiblePosts = (page) =>
  page.$$eval('article', (list) => list.filter((a) => a.offsetParent !== null).map((a) => a.textContent));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  let paging = 0;
  await context.route('https://www.instagram.com/**', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      paging++;
      return route.fulfill({ status: 200, body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: mock });
  });
  await context.addInitScript(script);
  const page = await context.newPage();
  await page.goto('https://www.instagram.com/');
  await page.waitForTimeout(1500);

  // 1. Ссылка на Reels скрыта, поиск остался.
  assert.strictEqual(await page.isVisible('nav a[href="/reels/"]'), false, 'вкладка Reels скрыта');
  assert.strictEqual(await page.isVisible('nav a[href="/explore/"]'), true, 'поиск остался');

  // 2. Сколько ни листай, показано ровно 10 постов, без рекламы и рекомендаций.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  }
  let posts = await visiblePosts(page);
  assert.strictEqual(posts.length, 10, 'показано 10 постов, а не ' + posts.length);
  assert.ok(posts.every((t) => !/ad|suggested/.test(t)), 'реклама и рекомендации скрыты');
  assert.strictEqual(await page.isVisible('#people'), false, 'блок «Рекомендации для вас» скрыт');

  // 3. Подгрузка остановилась, а не крутится в фоне.
  const before = paging;
  await page.waitForTimeout(1500);
  assert.strictEqual(paging, before, 'подгрузка ленты остановлена');
  assert.ok(paging <= 6, 'лишних запросов нет: ' + paging);

  // 4. В конце ленты появляется плашка, «Ещё 10» открывает следующую порцию.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  assert.strictEqual(await page.isVisible('#mg-bar'), false, 'в начале ленты плашки нет');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForSelector('#mg-bar.mg-on');
  await page.click('#mg-bar button:first-of-type');
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  }
  posts = await visiblePosts(page);
  assert.strictEqual(posts.length, 20, 'после «Ещё» показано 20 постов, а не ' + posts.length);

  // 5. Настройка «скрывать видео» убирает видео из ленты.
  assert.ok(posts.some((t) => /video/.test(t)), 'видео по умолчанию показываются');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForSelector('#mg-bar.mg-on');
  await page.click('#mg-bar button[aria-label]');
  await page.check('#mg-panel input[type=checkbox]');
  await page.click('#mg-panel button[type=submit]');
  await page.waitForTimeout(1500);
  posts = await visiblePosts(page);
  assert.ok(posts.every((t) => !/video/.test(t)), 'видео скрыты');
  assert.strictEqual(posts.length, 20, 'лимит сохраняется: ' + posts.length);

  // 6. Переход на /reels/ возвращает на главную.
  await page.evaluate(() => history.pushState({}, '', '/reels/'));
  await page.waitForURL('https://www.instagram.com/');

  await browser.close();
  console.log('OK: все проверки пройдены');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
