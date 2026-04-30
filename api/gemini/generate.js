import { handleGeminiGenerate } from '../../lib/vercelApiUtils.js';

export default async function handler(req, res) {
  return handleGeminiGenerate(req, res);
}
