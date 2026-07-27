import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import configRoutes from './routes/config.routes';
import { handleProxyRequest } from './proxy';
import { RECORDINGS_DIR } from './config';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('port', process.env.PORT ?? 3000);
app.set('json spaces', 2);

// ─── Routes ───────────────────────────────────────────────────────────────────

// Own REST API for the config panel
app.use('/api', configRoutes);

// Locally captured call-recording audio (see proxy.ts captureRecordingUrls) —
// serves .wav/.mp3 files saved from real S3 presigned URLs so replays never
// depend on an (expiring) signature again.
app.use('/recordings', express.static(RECORDINGS_DIR));

// Proxy catch-all — only intercepts traffic under /proxy/*
// This avoids any conflict with /api/* or any future own routes.
app.all('/proxy/*', (req, res) => {
  handleProxyRequest(req, res).catch((err) => {
    console.error('[server] Unhandled proxy error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = app.get('port') as number;
app.listen(port, () => {
  console.log(`\n🚀 ProxyCopyServer  →  http://localhost:${port}`);
  console.log(`   Proxy endpoint   →  http://localhost:${port}/proxy/<your-path>`);
  console.log(`🎛️  Config panel    →  check frontend/.env.local for its port\n`);
});
