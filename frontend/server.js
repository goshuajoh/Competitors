/**
 * server.js — Production server for the Chip Knowledge Graph.
 *
 * In production: serves the Vite build (dist/) + LLM API proxy.
 * In development: LLM API proxy only (Vite dev server handles frontend).
 *
 * Usage:
 *   cp .env.example .env        # Set API keys + optional APP_PASSWORD
 *   node server.js              # Starts on port 3001
 */

import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Middleware ─────────────────────────────────────────────────────────
if (IS_PROD) {
  app.use(cors({ origin: false })); // same-origin only
} else {
  app.use(cors());
}
app.use(express.json({ limit: '2mb' }));

// Sessions (for password auth)
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomUUID(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD && process.env.TRUST_PROXY === 'true',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

if (IS_PROD && process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// Serve built frontend in production
if (IS_PROD) {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// Rate limit on chat endpoint
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

// ── Auth ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!process.env.APP_PASSWORD) return next();
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.get('/api/auth/status', (req, res) => {
  res.json({
    required: !!process.env.APP_PASSWORD,
    authenticated: !!req.session?.authenticated,
  });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return res.json({ ok: true });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }

  // Timing-safe comparison
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ── System Prompt ─────────────────────────────────────────────────────
function buildSystemPrompt(chipContext, totalChips, totalManufacturers) {
  let contextBlock = '';

  if (chipContext?.type === 'summary') {
    contextBlock = `
KNOWLEDGE GRAPH SUMMARY (${totalChips} chips across ${totalManufacturers} manufacturers):
${JSON.stringify(chipContext.data, null, 2)}
`;
  } else if (chipContext?.type === 'chips') {
    contextBlock = `
RELEVANT CHIP DATA (from knowledge graph of ${totalChips} chips across ${totalManufacturers} manufacturers):
${JSON.stringify(chipContext.data, null, 2)}
`;
  }

  return `You are an expert IoT/embedded chip competitive analyst working for Espressif Systems.
You have access to a comprehensive knowledge graph containing detailed specifications for ${totalChips} chips across ${totalManufacturers} manufacturers.

Your role:
- Provide data-driven competitive analysis using the chip data provided
- Compare chips quantitatively (MHz, KB, protocols, features)
- Highlight Espressif's competitive advantages and recommend ESP replacements for competitor parts
- Note when data confidence is low or when information may be incomplete
- Use markdown tables when comparing multiple chips
- Be specific — cite actual numbers from the data, not vague claims
- When recommending ESP replacements, explain WHY each chip is a good match

Key Espressif differentiators to highlight when relevant:
- Price/performance ratio (typically lowest cost for WiFi+BLE combo)
- ESP-IDF mature SDK with FreeRTOS, Arduino, MicroPython support
- Matter/Thread support across C6, H2, and newer chips
- RISC-V transition (C-series and H-series)
- WiFi 6 support in ESP32-C5
- High-performance ESP32-P4 for edge computing
- Large and active developer community

Format guidelines:
- Use markdown formatting: **bold** for key points, tables for comparisons
- Keep responses focused and actionable
- Structure long answers with headers
- When comparing, always include a summary recommendation at the end

${contextBlock}`;
}

// ── Anthropic Handler ─────────────────────────────────────────────────
async function handleAnthropic(res, messages, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in .env' })}\n\n`);
    res.end();
    return;
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }
  } catch (err) {
    console.error('Anthropic error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ── OpenAI Handler ────────────────────────────────────────────────────
async function handleOpenAI(res, messages, systemPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: 'OPENAI_API_KEY not set in .env' })}\n\n`);
    res.end();
    return;
  }

  const client = new OpenAI({ apiKey });

  try {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }
  } catch (err) {
    console.error('OpenAI error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

// ── API Routes ────────────────────────────────────────────────────────
app.post('/api/chat', chatLimiter, requireAuth, (req, res) => {
  const { messages, provider = 'anthropic', chipContext, totalChips = 54, totalManufacturers = 16 } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const systemPrompt = buildSystemPrompt(chipContext, totalChips, totalManufacturers);

  if (provider === 'openai') {
    handleOpenAI(res, messages, systemPrompt);
  } else {
    handleAnthropic(res, messages, systemPrompt);
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
    },
  });
});

// SPA catch-all (production only — must be AFTER api routes)
if (IS_PROD) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Chip Knowledge Graph Server`);
  console.log(`  ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Auth:      ${process.env.APP_PASSWORD ? 'password required' : 'open (no APP_PASSWORD set)'}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET'}`);
  console.log(`  OpenAI:    ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET'}\n`);
});
