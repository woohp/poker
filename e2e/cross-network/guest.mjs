import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const [appUrl, room, run, settleMsText] = process.argv.slice(2);
const settleMs = Number(settleMsText);
const joinUrl = `${appUrl.replace(/\/$/, "")}/#/join/${room}`;
const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(new firefox.Options().addArguments("-headless"))
    .build();

try {
    await driver.get(joinUrl);
    await driver.executeScript(`
        localStorage.setItem("poker-webrtc-debug", "1");
        window.__connectionDiagnostics = [];
        const originalDebug = console.debug;
        console.debug = (...args) => {
            window.__connectionDiagnostics.push({
                wallTime: Date.now(),
                monotonicTime: performance.now(),
                args,
            });
            originalDebug(...args);
        };
    `);

    const name = await driver.wait(until.elementLocated(By.css("input")), 15_000);
    await name.sendKeys(`CrossNetworkGuest${run}`);
    const joinButton = (
        await driver.findElements(By.xpath('//button[normalize-space()="Join"]'))
    )[0];
    const clickWallTime = await driver.executeScript("return Date.now()");
    const clickMonotonicTime = await driver.executeScript("return performance.now()");
    await joinButton.click();
    await driver.wait(
        until.elementLocated(By.xpath('//*[contains(normalize-space(), "Players (2/10)")]')),
        60_000,
    );
    const playersTwoWallTime = await driver.executeScript("return Date.now()");
    const playersTwoMonotonicTime = await driver.executeScript("return performance.now()");
    await driver.sleep(settleMs);
    const diagnostics = await driver.executeScript("return window.__connectionDiagnostics || []");
    console.log(
        JSON.stringify({
            run,
            room,
            clickWallTime,
            clickMonotonicTime,
            playersTwoWallTime,
            playersTwoMonotonicTime,
            diagnostics,
        }),
    );
} finally {
    await driver.quit();
}
