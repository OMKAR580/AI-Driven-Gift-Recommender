import { handleHealth } from '../lib/vercelApiUtils.js';

export default async function handler(req, res) {
  return handleHealth(req, res);
}
