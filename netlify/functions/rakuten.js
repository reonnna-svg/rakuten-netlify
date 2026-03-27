export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const keyword = url.searchParams.get("keyword") || "ベッド";

    const appId = process.env.RAKUTEN_APP_ID;
    const accessKey = process.env.RAKUTEN_ACCESS_KEY;

    if (!appId || !accessKey) {
      return new Response(
        JSON.stringify({ error: "Missing env vars: RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY" }),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    const api = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601");
    api.searchParams.set("format", "json");
    api.searchParams.set("applicationId", appId);
    api.searchParams.set("accessKey", accessKey);
    api.searchParams.set("keyword", keyword);
    api.searchParams.set("hits", "1");

    const r = await fetch(api.toString(), {
      headers: {
        // 楽天の参照元チェック対策（Netlifyドメインに合わせる）
        "Referer": "https://cheerful-beijinho-a24d70.netlify.app/",
        "Origin": "https://cheerful-beijinho-a24d70.netlify.app",
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
      },
    });

    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};
