import { handleApiRequest } from "../lib/api-router.js";

export default async function handler(req, res) {
  return handleApiRequest(req, res);
}
