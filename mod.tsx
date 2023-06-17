/** @jsx h */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import html, { h } from "https://deno.land/x/htm@0.2.1/mod.ts";
import { KubeConfig } from "https://deno.land/x/kubernetes_client@v0.5.2/mod.ts";

const serverConfig = await KubeConfig.getInClusterConfig();
const serverCtx = serverConfig.fetchContext();

// change these as needed :)
const namespace = 'code-server';
const podName = 'srv-0';
const containerName = 'srv';

async function startTty(clientWs: WebSocket) {
  // Create a passthru stream to buffer client->server traffic
  // We already have stuff from the client, but we aren't connected to the server yet
  const clientToServer = new TransformStream();
  const serverWriter = clientToServer.writable.getWriter();

  clientWs.addEventListener('message', evt => {
    if (evt.data instanceof ArrayBuffer) {
      serverWriter.write(prependChannel(0, new Uint8Array(evt.data)));
    } else if (typeof evt.data == 'string') {
      const cmd = JSON.parse(evt.data);
      switch (cmd.msg) {
        case 'resize': {
          const json = JSON.stringify({ Width: cmd.size.cols, Height: cmd.size.rows });
          serverWriter.write(prependChannel(4, new TextEncoder().encode(json)));
        } break;
      }
      console.log('client command:', cmd);
    }
  });

  const path = `/api/v1/namespaces/${namespace}/pods/${podName}/exec?container=${containerName}&stdin=1&stdout=1&stderr=1&tty=1&command=bash&command=-il`;
  const url = new URL(path, serverCtx.cluster?.server);
  url.protocol = url.protocol.replace('http', 'ws');
  const serverWs = new WebSocketStream(url.toString(), {
    headers: {
      authorization: await serverCtx.getAuthHeader() ?? '',
    },
  });

  const serverConn = await serverWs.connection;

  clientToServer.readable.pipeTo(serverConn.writable);

  for await (const pkt of serverConn.readable) {
    if (pkt instanceof Uint8Array) {
      clientWs.send(pkt.slice(1));
    } else {
      console.log({pkt});
    }
  }
}

function prependChannel(idx: number, chunk: Uint8Array) {
  const buf = new ArrayBuffer(chunk.byteLength + 1);
  new DataView(buf).setUint8(0, idx);
  const array = new Uint8Array(buf);
  array.set(chunk, 1);
  return array;
}

const handler = (req: Request) => {
  const { pathname } = new URL(req.url);
  console.log(req.method, pathname);

  if (pathname === '/tty') {
    const upgrade = req.headers.get("upgrade") ?? "";
    if (req.method == 'GET' && upgrade.toLowerCase() == "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      startTty(socket);
      return response;
    }
    return new Response('not an upgrade', { status: 400 });
  }

  if (pathname === '/') return html({
    title: "Hello World!",
    styles: [
      "html, body { margin: 0; height: 100%; }",
      "body { background: #86efac; display: flex; flex-direction: column; align-items: center; justify-content: center; }",
      "#terminal { margin-top: 1em; padding: 0.5em; background-color: black; border-radius: 10px; }",
    ],
    links: [{
      href: 'https://unpkg.dev/xterm@5.2.1/css/xterm.css',
      rel: 'stylesheet',
    }],
    scripts: [{
      src: 'https://unpkg.dev/xterm@5.2.1/lib/xterm.js',
    }, {
      src: 'https://unpkg.dev/xterm-addon-fit@0.7.0/lib/xterm-addon-fit.js',
    }, {
      text: `
        const wsUrl = new URL('/tty', location);
        wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');

        const term = new Terminal();
        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        addEventListener("DOMContentLoaded", (event) => {
          const ws = new WebSocket(wsUrl);
          ws.addEventListener('message', async evt => {
            if (evt.data instanceof Blob) {
              term.write(new Uint8Array(await evt.data.arrayBuffer()));
            } else {
              console.log('received control payload:', evt.data);
            }
          });

          ws.addEventListener('open', evt => {
            term.onData(data => {
              ws.send(new TextEncoder().encode(data));
            });
            term.onResize(size => {
              console.log('resize:', {size});
              ws.send(JSON.stringify({
                msg: 'resize',
                size,
              }));
            });

            term.open(document.getElementById('terminal'));
            fitAddon.fit();
          });
        });
      `,
    }],
    body: (
      <body>
        <img width="64" src="https://dash.deno.com/assets/logo.svg" />
        <div id="terminal"></div>
      </body>
    ),
  });

  return new Response('404', { status: 404 });
};

serve(handler);
