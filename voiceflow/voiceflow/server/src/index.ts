import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Session } from './ws/session.js';

const PORT = Number(process.env.PORT ?? 8787);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    rimeConfigured: Boolean(process.env.RIME_API_KEY),
    llmConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const session = new Session(ws);
  session.stateMachine.forceTo('LISTENING');
  session.sendSystemInfo();

  ws.on('message', (data) => {
    session.handleMessage(data.toString()).catch((err) => {
      console.error('[session] unhandled error', err);
      session.send({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unexpected server error',
        recoverable: true,
      });
    });
  });

  ws.on('close', () => {
    session.reset();
  });
});

server.listen(PORT, () => {
  console.log(`VoiceFlow server listening on :${PORT} (ws path: /ws)`);
  if (!process.env.RIME_API_KEY) {
    console.warn(
      '[voiceflow] RIME_API_KEY is not set — the judged Rime speech path will fail until it is configured (see .env.example).',
    );
  }
});
