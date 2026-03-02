import { analyzeLaunch } from '../engines/curve.engine';
import { LaunchAnalysis } from '../types/pump.types';

export class LaunchService {
  async analyze(tokenMint: string): Promise<LaunchAnalysis> {
    return analyzeLaunch(tokenMint);
  }
}