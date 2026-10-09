// Run from the repo root with: playwright-cli run-code "$(cat scripts/check-accsoon-checkout.js)"
// Check local branding, then test local CSS on the real HTTPS checkout page; never submit payment.
async page => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto('http://127.0.0.1:8765/accsoon/');
    await page.evaluate(() => document.fonts.ready);
    if (/\bZR\s*Ctl\b/i.test(await page.locator('body').innerText())) throw Error('Old app name is visible');
    await page.screenshot({path:`output/playwright/accsoon-rebrand-${width}.png`});
    await page.goto('https://www.zrctl.com/accsoon/');
    await page.addStyleTag({path:'accsoon/accsoon.css'});
    await page.locator('[data-polar-checkout]').click();
    const frame = page.locator('body > iframe[src^="https://buy.polar.sh/"]');
    await frame.waitFor();
    const box = await frame.boundingBox();
    if (box.width > 562 || box.width >= width || box.height > 900 || box.x < 10 || box.y < 10) {
      throw Error('Checkout covers the page: ' + JSON.stringify(box));
    }
    const backdrop = await page.evaluate(() => {
      const style = getComputedStyle(document.body, '::after');
      return { background: style.backgroundColor, blur: style.backdropFilter };
    });
    if (!backdrop.blur.includes('blur(') || backdrop.background === 'rgba(0, 0, 0, 0)') throw Error('Missing dimmed, blurred backdrop');
    const checkout = page.frameLocator('body > iframe[src^="https://buy.polar.sh/"]');
    await checkout.getByRole('button', {name:'Pay now', exact:true}).waitFor({timeout:30000});
    await page.locator(".polar-loader-spinner").waitFor({state:"detached", timeout:30000});
    await checkout.frameLocator('iframe[title="Secure payment input frame"]').getByRole("textbox", {name:"Card number", exact:true}).waitFor({timeout:30000});
    // Stripe fades its iframe in after its fields exist; wait for the visible UI.
    await page.frames().find(frame => frame.url().startsWith('https://polar.sh/checkout/')).waitForFunction(() => {
      const cardFrame = document.querySelector('iframe[title="Secure payment input frame"]');
      return cardFrame && getComputedStyle(cardFrame).opacity === '1';
    });
    const content = await checkout.locator('body').innerText();
    if (!content.includes('$19.99')) throw Error('Incorrect checkout total');
    await page.screenshot({path:`output/playwright/accsoon-checkout-${width}.png`});
    await checkout.getByRole('button', {name:'Pay now', exact:true}).scrollIntoViewIfNeeded();
    // Preserve Polar's own close/confirmation behavior.
    await checkout.locator('#polar-embed-layout > button').click();
    await frame.waitFor({state:'detached'});
    if (await page.locator('body').evaluate(body => body.classList.contains('polar-no-scroll'))) throw Error('Scroll remained locked after close');
  }
}
