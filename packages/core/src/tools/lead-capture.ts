import { z } from 'zod';
import type { ToolResult, LeadData } from '../types.js';
import type { ChatTool } from './base.js';

export type LeadCaptureCallback = (lead: LeadData) => void | Promise<void>;

const leadInputSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  company: z.string().optional(),
  phone: z.string().optional(),
  projectDetails: z.string(),
});

export class LeadCaptureTool implements ChatTool {
  name = 'capture_lead';
  description = 'Capture contact information from a potential customer or lead. Call this when the user provides their name, email, and project details.';
  parameters = {
    name: { type: 'string' as const, description: 'Full name of the lead' },
    email: { type: 'string' as const, description: 'Email address' },
    company: { type: 'string' as const, description: 'Company name (if provided)' },
    phone: { type: 'string' as const, description: 'Phone number (if provided)' },
    projectDetails: { type: 'string' as const, description: 'Summary of what the lead needs' },
  };
  required = ['name', 'email', 'projectDetails'];

  private onCapture?: LeadCaptureCallback;

  constructor(onCapture?: LeadCaptureCallback) {
    this.onCapture = onCapture;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const parsed = leadInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: `Invalid lead data: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      };
    }

    const lead: LeadData = {
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company,
      phone: parsed.data.phone,
      projectDetails: parsed.data.projectDetails,
      source: 'chatcops-widget',
    };

    if (this.onCapture) {
      try {
        await this.onCapture(lead);
      } catch {
        return {
          success: false,
          message: 'Failed to process lead capture callback.',
        };
      }
    }

    return {
      success: true,
      data: lead,
      message: 'Lead information captured successfully.',
    };
  }
}
