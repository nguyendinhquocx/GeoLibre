import assert from "node:assert/strict";
import test from "node:test";
import {
  browserAssetHref,
  connectStac,
  isVisualizableAsset,
  itemBbox,
  searchStacApi,
  searchStaticStac,
} from "../packages/plugins/src/plugins/stac-api";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("browserAssetHref converts anonymous S3 STAC assets to fetchable HTTPS URLs", () => {
  assert.equal(
    browserAssetHref("s3://public-bucket/path/to/data.tif", "https://example.com/catalog/"),
    "https://public-bucket.s3.amazonaws.com/path/to/data.tif",
  );
  assert.equal(
    browserAssetHref("./data.tif", "https://example.com/catalog/item.json"),
    "https://example.com/catalog/data.tif",
  );
});

test("connectStac discovers relative API links and collections", async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/collections")) {
      return jsonResponse({ collections: [{ id: "landsat", title: "Landsat" }] });
    }
    return jsonResponse({
      id: "demo",
      title: "Demo STAC",
      conformsTo: ["https://api.stacspec.org/v1.0.0/item-search"],
      links: [
        { rel: "search", href: "./search" },
        { rel: "data", href: "./collections" },
      ],
    });
  }) as typeof fetch;

  const connection = await connectStac("https://example.com/stac/", fetcher);
  assert.equal(connection.isApi, true);
  assert.equal(connection.searchUrl, "https://example.com/stac/search");
  assert.deepEqual(
    connection.collections.map((collection) => collection.id),
    ["landsat"],
  );
  assert.deepEqual(calls, ["https://example.com/stac/", "https://example.com/stac/collections"]);
});

test("searchStacApi sends spatial, temporal, and collection filters and follows next", async () => {
  let body: Record<string, unknown> | undefined;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse({
      type: "FeatureCollection",
      numberMatched: 4,
      features: [
        {
          type: "Feature",
          id: "one",
          bbox: [-1, -2, 3, 4],
          geometry: null,
          properties: { datetime: "2024-01-01T00:00:00Z" },
          assets: {
            data: {
              href: "s3://public-bucket/one.tif",
              type: "image/tiff; application=geotiff",
            },
          },
        },
      ],
      links: [{ rel: "next", href: "?token=next", method: "POST", body: { token: "next" } }],
    });
  }) as typeof fetch;
  const connection = {
    url: "https://example.com/stac/",
    title: "Demo",
    isApi: true,
    searchUrl: "https://example.com/stac/search",
    collections: [],
    root: {},
  };
  const result = await searchStacApi(
    connection,
    {
      bbox: [-10, -5, 10, 5],
      datetime: "2024-01-01/2024-02-01",
      collections: ["demo"],
      additional: {
        query: { "eo:cloud_cover": { lt: 10 } },
        sortby: [{ field: "properties.datetime", direction: "desc" }],
        // Standard form fields remain authoritative.
        limit: 999,
        bbox: [0, 0, 0, 0],
      },
      limit: 10,
    },
    fetcher,
  );
  assert.deepEqual(body, {
    query: { "eo:cloud_cover": { lt: 10 } },
    sortby: [{ field: "properties.datetime", direction: "desc" }],
    limit: 10,
    bbox: [-10, -5, 10, 5],
    datetime: "2024-01-01/2024-02-01",
    collections: ["demo"],
  });
  assert.equal(result.items[0].id, "one");
  assert.equal(result.items[0].assets.data.href, "https://public-bucket.s3.amazonaws.com/one.tif");
  assert.equal(result.matched, 4);
  assert.deepEqual(result.next, {
    href: "https://example.com/stac/search?token=next",
    method: "POST",
    body: { token: "next" },
  });
});

test("searchStacApi falls back to GET when the search endpoint rejects POST", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method });
    if (init?.method === "POST") throw new Error("405 Method Not Allowed");
    return jsonResponse({
      type: "FeatureCollection",
      numberMatched: 1,
      features: [
        {
          type: "Feature",
          id: "get-only",
          bbox: [-1, -2, 3, 4],
          geometry: null,
          properties: { datetime: "2024-01-15T00:00:00Z" },
          assets: { data: { href: "https://example.com/one.tif" } },
        },
      ],
      links: [],
    });
  }) as typeof fetch;

  const result = await searchStacApi(
    {
      url: "https://example.com/stac/",
      title: "Demo",
      isApi: true,
      searchUrl: "https://example.com/stac/search",
      collections: [],
      root: {},
    },
    {
      bbox: [-10, -5, 10, 5],
      datetime: "2024-01-01/2024-02-01",
      collections: ["demo"],
      additional: { filter: { op: "=", args: [{ property: "platform" }, "sentinel-2a"] } },
      limit: 10,
    },
    fetcher,
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].method, undefined);
  const fallback = new URL(calls[1].url);
  assert.equal(fallback.pathname, "/stac/search");
  assert.equal(fallback.searchParams.get("limit"), "10");
  assert.equal(fallback.searchParams.get("bbox"), "-10,-5,10,5");
  assert.equal(fallback.searchParams.get("datetime"), "2024-01-01/2024-02-01");
  assert.equal(fallback.searchParams.get("collections"), "demo");
  assert.equal(
    fallback.searchParams.get("filter"),
    JSON.stringify({ op: "=", args: [{ property: "platform" }, "sentinel-2a"] }),
  );
  assert.equal(result.items[0].id, "get-only");
  assert.equal(result.matched, 1);
});

test("searchStaticStac traverses child and item links and applies filters", async () => {
  const docs: Record<string, unknown> = {
    "https://example.com/collection.json": {
      type: "Collection",
      links: [
        { rel: "item", href: "inside.json" },
        { rel: "item", href: "outside.json" },
        { rel: "item", href: "elevated.json" },
      ],
    },
    "https://example.com/inside.json": {
      type: "Feature",
      id: "inside",
      collection: "demo",
      bbox: [0, 0, 2, 2],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    },
    "https://example.com/outside.json": {
      type: "Feature",
      id: "outside",
      collection: "demo",
      bbox: [50, 50, 60, 60],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    },
    // 3D bbox: [minX, minY, minZ, maxX, maxY, maxZ]. Inside the search extent, but
    // reading it as 2D would compare minZ (-500) against the extent's minX and drop it.
    "https://example.com/elevated.json": {
      type: "Feature",
      id: "elevated",
      collection: "demo",
      bbox: [0, 0, -500, 2, 2, -100],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    },
  };
  const fetcher = (async (input: RequestInfo | URL) =>
    jsonResponse(docs[String(input)])) as typeof fetch;
  const result = await searchStaticStac(
    {
      url: "https://example.com/collection.json",
      title: "Static",
      isApi: false,
      collections: [],
      root: docs["https://example.com/collection.json"] as Record<string, unknown>,
    },
    { bbox: [-1, -1, 3, 3], datetime: "2024-01-01/2024-12-31", limit: 20 },
    fetcher,
  );
  assert.deepEqual(
    result.items.map((item) => item.id),
    ["inside", "elevated"],
  );
});

test("searchStaticStac pages through a catalog holding more items than one page fits", async () => {
  const total = 25;
  const docs: Record<string, unknown> = {
    "https://example.com/stac/catalog.json": {
      type: "Catalog",
      links: Array.from({ length: total }, (_value, index) => ({
        rel: "item",
        href: `./item${index}.json`,
      })),
    },
  };
  for (let index = 0; index < total; index += 1) {
    docs[`https://example.com/stac/item${index}.json`] = {
      type: "Feature",
      id: `item${index}`,
      collection: "many",
      bbox: [0, 0, 1, 1],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    };
  }
  const fetcher = (async (input: RequestInfo | URL) =>
    jsonResponse(docs[String(input)])) as typeof fetch;
  const connection = {
    url: "https://example.com/stac/catalog.json",
    title: "Static",
    isApi: false,
    collections: [],
    root: docs["https://example.com/stac/catalog.json"] as Record<string, unknown>,
  };

  const first = await searchStaticStac(connection, { limit: 10 }, fetcher);
  assert.equal(first.items.length, 10);
  assert.ok(first.cursor, "a walk with documents left over reports where it stopped");
  assert.equal(first.matched, undefined);

  const second = await searchStaticStac(connection, { limit: 10, cursor: first.cursor }, fetcher);
  assert.equal(second.items.length, 10);
  assert.deepEqual(
    second.items.map((item) => item.id).filter((id) => first.items.some((seen) => seen.id === id)),
    [],
    "a resumed page repeats nothing from the page before it",
  );

  const third = await searchStaticStac(connection, { limit: 10, cursor: second.cursor }, fetcher);
  assert.equal(third.items.length, 5);
  assert.equal(third.cursor, undefined, "the walk is done, so there is nothing to resume");
  assert.equal(third.matched, 25);
});

test("searchStaticStac reads items before folders, so a page is not spent on structure", async () => {
  // Items one folder down, behind a hundred empty ones. Discovery order spends the page on
  // folders and returns nothing.
  const docs: Record<string, unknown> = {
    "https://example.com/stac/catalog.json": {
      type: "Catalog",
      links: [
        { rel: "child", href: "./has-items.json" },
        ...Array.from({ length: 100 }, (_value, index) => ({
          rel: "child",
          href: `./empty${index}.json`,
        })),
      ],
    },
    "https://example.com/stac/has-items.json": {
      type: "Catalog",
      links: Array.from({ length: 3 }, (_value, index) => ({
        rel: "item",
        href: `./item${index}.json`,
      })),
    },
  };
  for (let index = 0; index < 100; index += 1) {
    docs[`https://example.com/stac/empty${index}.json`] = { type: "Catalog", links: [] };
  }
  for (let index = 0; index < 3; index += 1) {
    docs[`https://example.com/stac/item${index}.json`] = {
      type: "Feature",
      id: `item${index}`,
      collection: "c",
      bbox: [0, 0, 1, 1],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    };
  }
  let reads = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    reads += 1;
    return jsonResponse(docs[String(input)]);
  }) as typeof fetch;

  const result = await searchStaticStac(
    {
      url: "https://example.com/stac/catalog.json",
      title: "Static",
      isApi: false,
      collections: [],
      root: docs["https://example.com/stac/catalog.json"] as Record<string, unknown>,
    },
    { limit: 3 },
    fetcher,
  );

  assert.equal(result.items.length, 3);
  // Discovery order costs a hundred more.
  assert.ok(reads < 30, `expected the items to be reached quickly, took ${reads} reads`);
});

test("a page stops reading at its budget rather than crawling the whole catalog", async () => {
  // No items anywhere, so only the budget can end the page.
  let reads = 0;
  const fetcher = (async () => {
    reads += 1;
    return jsonResponse({
      type: "Catalog",
      links: [
        { rel: "child", href: `./${reads}-a.json` },
        { rel: "child", href: `./${reads}-b.json` },
      ],
    });
  }) as typeof fetch;

  const result = await searchStaticStac(
    {
      url: "https://example.com/stac/catalog.json",
      title: "Static",
      isApi: false,
      collections: [],
      root: { type: "Catalog", links: [{ rel: "child", href: "./a.json" }] },
    },
    { limit: 20 },
    fetcher,
  );

  assert.deepEqual(result.items, []);
  assert.ok(reads <= 300, `a page must stop at its budget, read ${reads}`);
  assert.ok(result.cursor, "and report that the walk is unfinished");
});

test("a read that fails once is retried rather than dropped from the search", async () => {
  // The batch leaves the queue before its requests go out, so a failure that took the batch with
  // it would strand every document in it — and any folder among them, its whole subtree.
  let failures = 0;
  const docs: Record<string, unknown> = {
    "https://example.com/stac/catalog.json": {
      type: "Catalog",
      links: [
        { rel: "item", href: "./flaky.json" },
        { rel: "item", href: "./steady.json" },
      ],
    },
  };
  for (const id of ["flaky", "steady"]) {
    docs[`https://example.com/stac/${id}.json`] = {
      type: "Feature",
      id,
      collection: "c",
      bbox: [0, 0, 1, 1],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    };
  }
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("flaky.json") && failures === 0) {
      failures += 1;
      throw new Error("network");
    }
    return jsonResponse(docs[url]);
  }) as typeof fetch;

  const connection = {
    url: "https://example.com/stac/catalog.json",
    title: "Static",
    isApi: false,
    collections: [],
    root: docs["https://example.com/stac/catalog.json"] as Record<string, unknown>,
  };

  const first = await searchStaticStac(connection, { limit: 20 }, fetcher);
  const ids = [...first.items.map((item) => item.id)];
  if (first.cursor) {
    const second = await searchStaticStac(connection, { limit: 20, cursor: first.cursor }, fetcher);
    ids.push(...second.items.map((item) => item.id));
  }
  assert.deepEqual(ids.sort(), ["flaky", "steady"]);
});

test("a page that runs out of reads before matching anything returns a cursor, not a total", async () => {
  // The panel says "no results" off a finished empty page, so an unfinished one must not look
  // finished: the match here sits past the first page's read budget.
  const root = {
    type: "Catalog",
    links: Array.from({ length: 400 }, (_, index) => ({
      rel: "child",
      href: `./child-${index}.json`,
    })),
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("child-399.json")) {
      return jsonResponse({ type: "Catalog", links: [{ rel: "item", href: "./deep.json" }] });
    }
    if (url.endsWith("deep.json")) {
      return jsonResponse({
        type: "Feature",
        id: "deep",
        collection: "c",
        bbox: [0, 0, 1, 1],
        geometry: null,
        properties: { datetime: "2024-05-01T00:00:00Z" },
        assets: {},
      });
    }
    return jsonResponse({ type: "Catalog", links: [] });
  }) as typeof fetch;

  const connection = {
    url: "https://example.com/stac/catalog.json",
    title: "Static",
    isApi: false,
    collections: [],
    root,
  };

  const first = await searchStaticStac(connection, { limit: 20 }, fetcher);
  assert.deepEqual(first.items, []);
  assert.ok(first.cursor, "an unfinished walk must hand back a cursor");
  assert.equal(first.matched, undefined, "an unfinished walk has no total to report");

  const second = await searchStaticStac(connection, { limit: 20, cursor: first.cursor }, fetcher);
  assert.deepEqual(
    second.items.map((item) => item.id),
    ["deep"],
  );
  assert.equal(second.cursor, undefined);
  assert.equal(second.matched, 1);
});

test("a document that never reads leaves the search without a total", async () => {
  const docs: Record<string, unknown> = {
    "https://example.com/stac/catalog.json": {
      type: "Catalog",
      links: [
        { rel: "item", href: "./good.json" },
        { rel: "child", href: "./dead.json" },
      ],
    },
    "https://example.com/stac/good.json": {
      type: "Feature",
      id: "good",
      collection: "c",
      bbox: [0, 0, 1, 1],
      geometry: null,
      properties: { datetime: "2024-05-01T00:00:00Z" },
      assets: {},
    },
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("dead.json")) throw new Error("gone");
    return jsonResponse(docs[url]);
  }) as typeof fetch;

  const connection = {
    url: "https://example.com/stac/catalog.json",
    title: "Static",
    isApi: false,
    collections: [],
    root: docs["https://example.com/stac/catalog.json"] as Record<string, unknown>,
  };

  let result = await searchStaticStac(connection, { limit: 20 }, fetcher);
  const ids = result.items.map((item) => item.id);
  while (result.cursor) {
    result = await searchStaticStac(connection, { limit: 20, cursor: result.cursor }, fetcher);
    ids.push(...result.items.map((item) => item.id));
  }
  assert.deepEqual(ids, ["good"]);
  // The dead child's subtree went unread, so "1 of 1" would overstate what was searched.
  assert.equal(result.matched, undefined);
});

test("asset and bbox helpers recognize common STAC data", () => {
  assert.equal(isVisualizableAsset({ href: "https://example.com/a.TIF?download=1" }), true);
  assert.equal(isVisualizableAsset({ href: "https://example.com/data.bin" }), false);
  assert.deepEqual(
    itemBbox({
      type: "Feature",
      id: "3d",
      bbox: [1, 2, 10, 3, 4, 20],
      geometry: null,
      properties: {},
      assets: {},
    }),
    [1, 2, 3, 4],
  );
});
