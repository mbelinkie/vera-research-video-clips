import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";

// This fixture is intentionally boring and local. Its text is synthetic and
// contains no account, subscription, or personal data.
export const FIXTURE_QUOTE =
  "The field team kept the original notes because each small detail changed the final map.";
export const FIXTURE_BEFORE = "The first pass was cautious.";
export const FIXTURE_AFTER = "That record stayed with the project.";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const AUDIO_BYTES = Buffer.from("synthetic-audio-fixture", "utf8");

export type SyntheticFixture = {
  origin: string;
  articleUrl: string;
  imageUrl: string;
  audioUrl: string;
  youtubeUrl: string;
  requests: string[];
  close: () => Promise<void>;
};

function write(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  contentType: string,
) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function redirectToLogin(response: ServerResponse) {
  response.writeHead(302, {
    location: "/article?utm_source=synthetic",
    "cache-control": "no-store",
    "set-cookie":
      "synthetic_session=fixture-only; HttpOnly; SameSite=Lax; Path=/",
  });
  response.end();
}

function articleHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Synthetic Field Notes</title>
    <meta name="author" content="Avery Example">
    <meta property="og:site_name" content="Synthetic Review">
    <meta property="article:published_time" content="2026-11-19">
    <meta name="description" content="A local article fixture for extension capture tests.">
    <style>
      body { margin: 0; background: #f6f1e7; color: #222; font: 18px/1.6 system-ui, sans-serif; }
      main { box-sizing: border-box; width: 608px; height: calc(100vh - 80px); margin: 0 auto; padding: 48px 24px 160px; overflow: auto; }
      article { background: white; padding: 32px; box-shadow: 0 4px 20px rgb(0 0 0 / .12); }
      h1 { border-top: 24px solid rgb(0,140,240); }
      [data-fixture="quote"] { display: block; width: 250px; }
      [data-fixture="quote"] { color: rgb(220,0,210); }
      [data-fixture="quote"]::selection { color: rgb(220,0,210); background: rgb(0,255,0); }
      img { display: block; width: 320px; height: 180px; image-rendering: pixelated; object-fit: cover; }
      .spacer { height: 100vh; }
    </style>
  </head>
  <body>
    <main>
      <article data-fixture="article">
        <h1>Synthetic Field Notes</h1>
        <p>By Avery Example · Synthetic Review · November 19, 2026</p>
        <img data-fixture="top-image" src="/fixture-image.png" alt="A synthetic blue field map">
        <div class="spacer" aria-hidden="true"></div>
        <p>${FIXTURE_BEFORE}</p>
        <p data-fixture="quote">${FIXTURE_QUOTE}</p>
        <p>${FIXTURE_AFTER}</p>
        <div class="spacer" aria-hidden="true"></div>
        <p data-fixture="second-quote">A second passage from this local page is deliberately separate.</p>
        <p><a data-fixture="audio-link" href="/fixture-audio.mp3">Synthetic audio file</a></p>
      </article>
    </main>
  </body>
</html>`;
}

function youtubeHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Synthetic Video</title></head>
<body><main data-fixture="youtube">
  <h1>Synthetic Video</h1><p>This local page represents a YouTube-shaped source.</p>
  <a href="/watch?v=synthetic-video">Synthetic video</a>
</main></body></html>`;
}

export async function createSyntheticExtensionFixture(): Promise<SyntheticFixture> {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(url.pathname);
    if (request.method === "HEAD") {
      response.writeHead(200, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/login") {
      redirectToLogin(response);
      return;
    }
    if (url.pathname === "/article") {
      if (!request.headers.cookie?.includes("synthetic_session=fixture-only")) {
        write(
          response,
          401,
          "fixture login required",
          "text/plain; charset=utf-8",
        );
        return;
      }
      write(response, 200, articleHtml(), "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/fixture-image.png") {
      write(response, 200, PNG_1X1, "image/png");
      return;
    }
    if (url.pathname === "/fixture-audio.mp3") {
      write(response, 200, AUDIO_BYTES, "audio/mpeg");
      return;
    }
    if (url.pathname === "/watch") {
      write(response, 200, youtubeHtml(), "text/html; charset=utf-8");
      return;
    }
    write(response, 404, "not found", "text/plain; charset=utf-8");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Synthetic fixture did not bind a TCP port");
  }
  const origin = `http://localhost:${address.port}`;
  return {
    origin,
    articleUrl: `${origin}/article?utm_source=synthetic`,
    imageUrl: `${origin}/fixture-image.png`,
    audioUrl: `${origin}/fixture-audio.mp3`,
    youtubeUrl: `${origin}/watch?v=synthetic-video`,
    requests,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
