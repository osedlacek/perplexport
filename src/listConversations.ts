import { HTTPRequest, Page } from "puppeteer";
import { Conversation, DoneFile } from "./types";
import { sleep } from "./utils";

// Perplexity's library page makes a POST to /rest/thread/list_ask_threads
// with a body shaped like:
//   {"limit":20,"ascending":false,"offset":0,"search_term":"","exclude_asi":false,"include_assets":true}
// We capture the natural call to learn its exact body shape, then replay with
// limit=100 and walking offset to enumerate the full thread archive (the
// previous data-testid-based DOM scrape only saw the most recent ~20 threads
// in the sidebar, not the full library).

interface CapturedCall {
  body: string | null;
  headers: Record<string, string> | null;
}

async function captureListAskThreadsBody(page: Page): Promise<CapturedCall> {
  let body: string | null = null;
  let headers: Record<string, string> | null = null;
  const handler = (req: HTTPRequest): void => {
    if (req.url().includes("list_ask_threads") && req.method() === "POST" && !body) {
      body = req.postData() || null;
      headers = req.headers();
    }
  };
  page.on("request", handler);
  await page.goto("https://www.perplexity.ai/library");
  // Wait briefly for the natural call to fire
  const start = Date.now();
  while (!body && Date.now() - start < 15000) {
    await sleep(500);
  }
  page.off("request", handler);
  return { body, headers };
}

interface RawThread {
  uuid?: string;
  frontend_uuid?: string;
  title?: string;
  query_str?: string;
  link?: string;
}

async function paginateListAskThreads(
  page: Page,
  observedBody: string,
  observedHeaders: Record<string, string> | null
): Promise<RawThread[]> {
  return await page.evaluate(
    async (origBody: string, origHeaders: Record<string, string> | null) => {
      const all: RawThread[] = [];
      const url = "/rest/thread/list_ask_threads?version=2.18&source=default";
      let baseObj: Record<string, unknown> = {};
      try {
        baseObj = origBody ? JSON.parse(origBody) : {};
      } catch {
        baseObj = {};
      }
      const desiredLimit = 100;
      baseObj.limit = desiredLimit;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (origHeaders && origHeaders["content-type"]) {
        headers["Content-Type"] = origHeaders["content-type"];
      }

      let offset = 0;
      for (let iter = 0; iter < 500; iter++) {
        const body = Object.assign({}, baseObj, { offset });
        const resp = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify(body),
        });
        if (!resp.ok) break;
        const data: any = await resp.json();
        const batch: RawThread[] = Array.isArray(data)
          ? data
          : data.threads || data.ask_threads || data.items || data.results || data.data || [];
        if (!batch.length) break;
        const seen = new Set(all.map((t) => t.uuid || t.frontend_uuid));
        let newCount = 0;
        for (const t of batch) {
          const k = t.uuid || t.frontend_uuid;
          if (k && !seen.has(k)) {
            all.push(t);
            seen.add(k);
            newCount += 1;
          }
        }
        if (newCount === 0) break; // pagination not advancing
        offset += batch.length;
      }
      return all;
    },
    observedBody,
    observedHeaders
  );
}

function buildConversation(t: RawThread): Conversation | null {
  const id = t.uuid || t.frontend_uuid;
  if (!id && !t.link) return null;
  let url: string;
  if (t.link) {
    url = t.link.startsWith("http")
      ? t.link
      : `https://www.perplexity.ai${t.link.startsWith("/") ? "" : "/"}${t.link}`;
  } else {
    // Note: Perplexity's slug field in this response equals the uuid, so we
    // don't concatenate it — use uuid alone, the canonical thread URL form.
    url = `https://www.perplexity.ai/search/${id}`;
  }
  return { title: t.title || t.query_str || "Untitled", url };
}

export async function getConversations(
  page: Page,
  doneFile: DoneFile
): Promise<Conversation[]> {
  console.log("Capturing /library's list_ask_threads POST...");
  const captured = await captureListAskThreadsBody(page);
  if (!captured.body) {
    throw new Error(
      "Could not observe a list_ask_threads POST when navigating /library. " +
        "Perplexity may have changed the API; please file an issue."
    );
  }

  console.log("Paginating list_ask_threads to enumerate full library...");
  const rawThreads = await paginateListAskThreads(page, captured.body, captured.headers);
  console.log(`  Found ${rawThreads.length} threads in library`);

  const conversations = rawThreads
    .map(buildConversation)
    .filter((c): c is Conversation => c !== null);

  return conversations
    .filter((conv) => !doneFile.processedUrls.includes(conv.url))
    .reverse();
}
