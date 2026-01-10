// Vercel Serverless Function: same-origin JSON-RPC proxy for Casper nodes.
//
// Why: many Casper node RPC endpoints do not include CORS headers, so browser requests fail.
// This proxy lets the frontend use `/rpc` (via vercel.json rewrite) in production hosting.
//
// Configure the upstream RPC URL in Vercel env:
// - CASPER_NODE_RPC_URL (recommended)
// Fallback:
// - https://node.testnet.casper.network/rpc

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.end('')
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Allow', 'POST, OPTIONS')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const upstream =
    process.env.CASPER_NODE_RPC_URL ||
    process.env.CSPR_NODE_RPC_URL ||
    'https://node.testnet.casper.network/rpc'

  try {
    let body = req.body
    if (body == null) {
      const raw = await readRawBody(req)
      body = raw ? JSON.parse(raw) : null
    }

    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: body == null ? '' : JSON.stringify(body),
    })

    const text = await upstreamRes.text()
    res.statusCode = upstreamRes.status
    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    // Never cache JSON-RPC.
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Bad Gateway' }))
  }
}
