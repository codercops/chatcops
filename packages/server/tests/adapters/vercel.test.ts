import { describe, it, expect } from 'vitest';
import { chatcopsVercelHandler } from '../../src/adapters/vercel.js';

const config = {
  provider: { type: 'claude' as const, apiKey: 'test-key' },
  systemPrompt: 'Test',
  cors: '*',
};

describe('chatcopsVercelHandler', () => {
  const handler = chatcopsVercelHandler(config);

  it('returns 405 for non-POST requests', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handler(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns Access-Control-Allow-Origin: * for 405 when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns custom Access-Control-Allow-Origin for 405 when cors is configured', async () => {
    const handlerWithCustomCors = chatcopsVercelHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: 'https://example.com',
    });
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handlerWithCustomCors(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns 204 for OPTIONS (CORS preflight)', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'OPTIONS' });
    const res = await handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns Access-Control-Allow-Origin: * for OPTIONS when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', { method: 'OPTIONS' });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns Access-Control-Allow-Origin: * for 400 when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns custom Access-Control-Allow-Origin for 400 when cors is configured', async () => {
    const handlerWithCustomCors = chatcopsVercelHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: 'https://example.com',
    });
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handlerWithCustomCors(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});
