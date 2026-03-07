import { describe, it, expect, vi } from 'vitest';
import { LeadCaptureTool } from '../../src/tools/lead-capture.js';

describe('LeadCaptureTool', () => {
  it('has correct name and description', () => {
    const tool = new LeadCaptureTool();
    expect(tool.name).toBe('capture_lead');
    expect(tool.description).toBeTruthy();
    expect(tool.required).toContain('name');
    expect(tool.required).toContain('email');
    expect(tool.required).toContain('projectDetails');
  });

  it('executes and returns lead data', async () => {
    const tool = new LeadCaptureTool();
    const result = await tool.execute({
      name: 'John Doe',
      email: 'john@example.com',
      projectDetails: 'Need a website',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      name: 'John Doe',
      email: 'john@example.com',
      projectDetails: 'Need a website',
      source: 'chatcops-widget',
    });
  });

  it('calls onCapture callback when provided', async () => {
    const onCapture = vi.fn();
    const tool = new LeadCaptureTool(onCapture);

    await tool.execute({
      name: 'Jane',
      email: 'jane@example.com',
      projectDetails: 'Mobile app',
      company: 'Acme',
    });

    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jane',
        email: 'jane@example.com',
        company: 'Acme',
      })
    );
  });

  it('rejects when name is missing', async () => {
    const tool = new LeadCaptureTool();
    const result = await tool.execute({
      email: 'john@example.com',
      projectDetails: 'Need a website',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid lead data');
  });

  it('rejects when email is invalid', async () => {
    const tool = new LeadCaptureTool();
    const result = await tool.execute({
      name: 'John',
      email: 'not-an-email',
      projectDetails: 'Need a website',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid lead data');
  });

  it('rejects when projectDetails is missing', async () => {
    const tool = new LeadCaptureTool();
    const result = await tool.execute({
      name: 'John',
      email: 'john@example.com',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid lead data');
  });

  it('handles callback errors gracefully', async () => {
    const onCapture = vi.fn().mockRejectedValue(new Error('callback failed'));
    const tool = new LeadCaptureTool(onCapture);
    const result = await tool.execute({
      name: 'John',
      email: 'john@example.com',
      projectDetails: 'Need a website',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to process lead capture callback');
  });

  it('handles optional fields', async () => {
    const tool = new LeadCaptureTool();
    const result = await tool.execute({
      name: 'Test',
      email: 'test@test.com',
      projectDetails: 'Testing',
    });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).company).toBeUndefined();
    expect((result.data as Record<string, unknown>).phone).toBeUndefined();
  });
});
