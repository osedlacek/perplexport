import { promises as fs } from "fs";
import puppeteer from "puppeteer-extra";
import { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ConversationSaver } from "./ConversationSaver";
import { getConversations } from "./listConversations";
import { login } from "./login";
import renderConversation from "./renderConversation";
import { loadDoneFile, saveDoneFile, sleep } from "./utils";

export interface ExportLibraryOptions {
  outputDir: string;
  doneFilePath: string;
  email: string;
}

export default async function exportLibrary(options: ExportLibraryOptions) {
  puppeteer.use(StealthPlugin());

  await fs.mkdir(options.outputDir, { recursive: true });

  const doneFile = await loadDoneFile(options.doneFilePath);
  console.log(`Loaded ${doneFile.processedUrls.length} processed URLs from done file`);

  const browser: Browser = await puppeteer.launch({
    // Authentication is interactive — user types the login code into the window.
    headless: false,
  });

  try {
    let page: Page = await browser.newPage();

    await login(page, options.email);
    const conversations = await getConversations(page, doneFile);

    console.log(`Found ${conversations.length} new conversations to process`);

    let conversationSaver = new ConversationSaver(page);
    await conversationSaver.initialize();

    // Page-recreation recovery — if the page detaches mid-run (Chromium
    // tab crash, navigation issue), recreate it. Cookies persist on the
    // browser context so no re-login is needed.
    const recreatePage = async (reason: string): Promise<void> => {
      console.log(`  ↻ Recreating page (${reason})...`);
      try { await page.close(); } catch { /* already closed */ }
      page = await browser.newPage();
      conversationSaver = new ConversationSaver(page);
      await conversationSaver.initialize();
      try {
        await page.goto("https://www.perplexity.ai/", { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch { /* best-effort */ }
      await sleep(2000);
    };

    let okCount = 0;
    let failCount = 0;
    let recoveryCount = 0;
    const maxRecoveriesPerRun = 5;

    for (const conversation of conversations) {
      console.log(`Processing conversation ${conversation.url}`);
      let attempt = 0;
      const maxAttempts = 2;
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          const threadData = await conversationSaver.loadThreadFromURL(conversation.url);

          await fs.writeFile(
            `${options.outputDir}/${threadData.id}.json`,
            JSON.stringify(threadData.conversation, null, 2)
          );

          let markdown: string;
          try {
            markdown = renderConversation(threadData.conversation);
          } catch (renderErr: any) {
            console.error(`  Render failed (saving JSON only): ${renderErr.message}`);
            markdown = `# Render error\n\nSee ${threadData.id}.json for raw data.\n\nError: ${renderErr.message}\n`;
          }
          await fs.writeFile(`${options.outputDir}/${threadData.id}.md`, markdown);

          doneFile.processedUrls.push(conversation.url);
          await saveDoneFile(doneFile, options.doneFilePath);
          okCount += 1;
          break;
        } catch (err: any) {
          const msg: string = err.message || String(err);
          const isFrameError =
            msg.includes("detached Frame") ||
            msg.includes("Target closed") ||
            msg.includes("Session closed") ||
            msg.includes("Protocol error");
          if (isFrameError && attempt < maxAttempts && recoveryCount < maxRecoveriesPerRun) {
            recoveryCount += 1;
            console.error(`  Frame error (attempt ${attempt}/${maxAttempts}, recovery ${recoveryCount}/${maxRecoveriesPerRun}): ${msg}`);
            await recreatePage("frame error");
            continue;
          }
          console.error(`  FAILED ${conversation.url}: ${msg}`);
          failCount += 1;
          break;
        }
      }
      await sleep(2000); // be polite
    }
    console.log(`Done. Processed: ${okCount} OK, ${failCount} failed. Recoveries used: ${recoveryCount}/${maxRecoveriesPerRun}`);
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    await browser.close();
  }
}
