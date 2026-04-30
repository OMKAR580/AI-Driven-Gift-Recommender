import { handleImageResolve } from '../../lib/vercelApiUtils.js';

export default async function handler(req, res) {
  return handleImageResolve(req, res);
}
