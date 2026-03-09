import type { APIRoute } from 'astro';
import { incrementVisitors, getVisitors } from '../../lib/upstash';

export const prerender = false;

const SITE = 'chatcops';
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export const POST: APIRoute = async () => {
  try {
    const counts = await incrementVisitors(SITE);
    return new Response(JSON.stringify(counts), { headers: HEADERS });
  } catch {
    return new Response(JSON.stringify({ today: 0, total: 0 }), { status: 500, headers: HEADERS });
  }
};

export const GET: APIRoute = async () => {
  try {
    const counts = await getVisitors(SITE);
    return new Response(JSON.stringify(counts), { headers: HEADERS });
  } catch {
    return new Response(JSON.stringify({ today: 0, total: 0 }), { status: 500, headers: HEADERS });
  }
};
