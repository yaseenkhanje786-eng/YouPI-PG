// FriendPy staging connectivity test. NOT a payment gateway deployment.
// All payment, checkout and admin routes are intentionally unavailable publicly.
// Uses an in-memory database: data is disposable. Never supply real credentials.
import http from 'node:http';
import { Database } from '@youpi/db';
import { createPaymentApp } from '../apps/payment-api/src/index.js';
import { CheckoutServer } from '../apps/checkout-portal/src/server.js';

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => resolve(server.address().port));
});
const db = new Database({ inMemory: true });
const app = createPaymentApp(db);
// No observer or real payment data is used in this staging process.
app.context.observerPollerService.destroy();
const apiPort = await listen(app.rawServer, 0, '127.0.0.1');
const checkout = new CheckoutServer({apiBaseUrl: `http://127.0.0.1:${apiPort}`}).createServer();
const checkoutPort = await listen(checkout, 0, '127.0.0.1');
const publicServer = http.createServer(async (req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') {
    res.writeHead(404, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    return res.end(JSON.stringify({error:'Test-only service. Payments are disabled.'}));
  }
  try {
    const [api, portal] = await Promise.all([
      fetch(`http://127.0.0.1:${apiPort}/health`, {signal:AbortSignal.timeout(3000)}),
      fetch(`http://127.0.0.1:${checkoutPort}/health`, {signal:AbortSignal.timeout(3000)})
    ]);
    const healthy = api.ok && portal.ok;
    res.writeHead(healthy?200:503, {'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({status:healthy?'ok':'unavailable', mode:'test-only', api:api.ok, checkout:portal.ok, payments_enabled:false}));
  } catch {
    res.writeHead(503, {'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({status:'unavailable', mode:'test-only', payments_enabled:false}));
  }
});
const publicPort = Number(process.env.PORT || 10000);
await listen(publicServer, publicPort, '0.0.0.0');
console.log(`FriendPy test-only health server listening on ${publicPort}; payments disabled`);
let stopping = false;
function stop() {
  if (stopping) return; stopping=true;
  publicServer.close(); checkout.close(); app.destroy(); app.rawServer.close(); db.close();
  setTimeout(()=>process.exit(0), 100).unref();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
