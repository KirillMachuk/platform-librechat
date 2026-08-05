import { FullConfig } from '@playwright/test';
import authenticate from './authenticate';
import { getE2EUser } from './user';
import warmUp from './warm-up';

async function globalSetup(config: FullConfig) {
  await authenticate(config, getE2EUser());
  await warmUp(config);
}

export default globalSetup;
