import { describe, it, expect } from 'vitest';
import { chatcopsCloudflareHandler } from '../../src/adapters/cloudflare.js';

const config = {
  provider: { type: 'claude' as const, apiKey: 'test-key' },
  systemPrompt: 'Test',
  cors: '*',
};

describe('chatcopsCloudflareHandler', () => {
  const handler = chatcopsCloudflareHandler(config);

  it('returns 405 for non-POST requests', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handler(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
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
    const handlerWithoutCors = chatcopsCloudflareHandler({
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

  it('returns Access-Control-Allow-Origin: * for 405 and 400 when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsCloudflareHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });

    const req405 = new Request('http://localhost/api/chat', { method: 'GET' });
    const res405 = await handlerWithoutCors(req405);
    expect(res405.status).toBe(405);
    expect(res405.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const req400 = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'invalid-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res400 = await handlerWithoutCors(req400);
    expect(res400.status).toBe(400);
    expect(res400.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns custom Access-Control-Allow-Origin for 405 and 400 when cors is configured', async () => {
    const customCorsHandler = chatcopsCloudflareHandler({
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
      cors: 'https://example.com',
    });

    const req405 = new Request('http://localhost/api/chat', { method: 'GET' });
    const res405 = await customCorsHandler(req405);
    expect(res405.status).toBe(405);
    expect(res405.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');

    const req400 = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'invalid-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res400 = await customCorsHandler(req400);
    expect(res400.status).toBe(400);
    expect(res400.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });
});
