const clients = new Set();

export function addClient(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const client = { res };
  clients.add(client);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      cleanup();
    }
  }, 25000);

  function cleanup() {
    clearInterval(ping);
    clients.delete(client);
    try { res.end(); } catch {}
  }
  req.on('close', cleanup);
  res.on('error', cleanup);
  return client;
}

export function broadcast(type, payload = {}) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

export function clientCount() {
  return clients.size;
}
