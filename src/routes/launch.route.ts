import { Router, Request, Response } from 'express';
import { LaunchService } from '../services/launch.service';

const router = Router();
const service = new LaunchService();

router.post('/launch', async (req: Request, res: Response) => {
  try {
    const { tokenMint } = req.body;
    if (!tokenMint || typeof tokenMint !== 'string') {
      return res.status(400).json({ error: 'tokenMint is required (string)' });
    }

    const analysis = await service.analyze(tokenMint);
    res.json(analysis);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;