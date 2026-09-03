/**
 * SSE MCP client for Affinity (protocol 2025-11-25, IPv6 :6767).
 *   node scripts/affinity-mcp-client.mjs tools
 *   node scripts/affinity-mcp-client.mjs call <toolName> [jsonArgs]
 */
import http from 'node:http';

const HOST = '::1';
const PORT = 6767;

function log(...args) {
  console.error('[affinity-mcp]', ...args);
}

function sseConnect() {
  return new Promise((resolve, reject) => {
    let opened = false;
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        family: 6,
        path: '/sse',
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE HTTP ${res.statusCode}`));
          return;
        }
        let buf = '';
        const pending = new Map();
        const onData = (chunk) => {
          buf += chunk.toString('utf8').replace(/\r\n/g, '\n');
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const block of parts) {
            let event = 'message';
            const dataLines = [];
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
            }
            const data = dataLines.join('\n');
            if (event === 'heartbeat' || !data) continue;
            if (event === 'endpoint') {
              const sessionPath = data.startsWith('/') ? data : `/${data}`;
              opened = true;
              log('session', sessionPath);
              resolve({ sessionPath, pending, req, res });
              continue;
            }
            try {
              const msg = JSON.parse(data);
              if (msg.id != null && pending.has(msg.id)) {
                const { resolve: ok, reject: fail } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) fail(new Error(JSON.stringify(msg.error)));
                else ok(msg.result);
              }
            } catch (err) {
              log('parse fail', data.slice(0, 200), err.message);
            }
          }
        };
        res.on('data', onData);
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
    setTimeout(() => {
      if (!opened) reject(new Error('SSE endpoint timeout'));
    }, 8000);
  });
}

function postMessage(sessionPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        family: 6,
        path: sessionPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`POST ${res.statusCode} ${text}`));
          } else {
            resolve(text);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let nextId = 1;
async function rpc(sessionPath, pending, method, params, timeoutMs = 60_000) {
  const id = nextId++;
  const wait = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, timeoutMs);
  });
  await postMessage(sessionPath, { jsonrpc: '2.0', id, method, params });
  return wait;
}

const { sessionPath, pending, req } = await sseConnect();
const init = await rpc(sessionPath, pending, 'initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'grok-affinity-client', version: '1.0.0' }
});
log('initialized', init?.serverInfo?.name, init?.protocolVersion);
await postMessage(sessionPath, { jsonrpc: '2.0', method: 'notifications/initialized' });

async function dump(result, fallbackName) {
  const text = JSON.stringify(result ?? { empty: true }, null, 2);
  const outPath = process.env.AFFINITY_MCP_OUT || fallbackName;
  if (outPath) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(outPath, text, 'utf8');
    log('wrote', outPath, text.length);
  }
  const preview = text.length > 4000 ? `${text.slice(0, 4000)}\n...[truncated ${text.length}]` : text;
  console.log(preview);
}

const cmd = process.argv[2] ?? 'tools';
log('argv', process.argv.slice(2).join(' | '));
try {
  if (cmd === 'tools') {
    const tools = await rpc(sessionPath, pending, 'tools/list', {});
    console.log(JSON.stringify(tools, null, 2));
  } else if (cmd === 'session') {
    // AFFINITY_MCP_PLAN = JSON array of { tool, args, out? }
    const planPath = process.env.AFFINITY_MCP_PLAN;
    if (!planPath) throw new Error('AFFINITY_MCP_PLAN required');
    const plan = JSON.parse(await (await import('node:fs/promises')).readFile(planPath, 'utf8'));
    for (const step of plan) {
      log('step', step.tool);
      const result = await rpc(sessionPath, pending, 'tools/call', { name: step.tool, arguments: step.args ?? {} }, 180_000);
      await dump(result, step.out);
    }
  } else if (cmd === 'call') {
    const name = process.argv[3];
    const argsFile = process.env.AFFINITY_MCP_ARGS;
    const rawArgs = argsFile
      ? await (await import('node:fs/promises')).readFile(argsFile, 'utf8')
      : (process.argv[4] ?? '{}');
    let args;
    try {
      args = JSON.parse(rawArgs);
    } catch (err) {
      throw new Error(`bad json args: ${rawArgs.slice(0, 120)} (${err.message})`);
    }
    log('call', name, JSON.stringify(args).slice(0, 200));
    const result = await rpc(sessionPath, pending, 'tools/call', { name, arguments: args }, 180_000);
    const text = JSON.stringify(result ?? { empty: true }, null, 2);
    const outPath = process.env.AFFINITY_MCP_OUT;
    if (outPath) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outPath, text, 'utf8');
      log('wrote', outPath, text.length);
    }
    console.log(text);
  } else {
    console.error('usage: tools | call <name> [json-args]');
    process.exitCode = 1;
  }
} catch (err) {
  log('FAIL', err.message);
  process.exitCode = 1;
} finally {
  req.destroy();
  process.exit(process.exitCode ?? 0);
}
