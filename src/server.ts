import express from 'express';
import cors from 'cors';
import launchRoute from './routes/launch.route';
import { connection } from './config';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', launchRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rpc: connection.rpcEndpoint.substring(0, 40) + '...' });
});

app.listen(PORT, () => {
  console.log(`🚀 Pump Launch Terminal running on http://localhost:${PORT}`);
  console.log(`POST /api/launch with { "tokenMint": "..." }`);
});