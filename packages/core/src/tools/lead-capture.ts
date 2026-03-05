import type { ToolResult, LeadData } from '../types.js';
import type { ChatTool } from './base.js';

export type LeadCaptureCallback = (lead: LeadData) => void | Promise<void>;

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
    const lead: LeadData = {
      name: input.name as string,
      email: input.email as string,
      company: input.company as string | undefined,
      phone: input.phone as string | undefined,
      projectDetails: input.projectDetails as string,
      source: 'chatcops-widget',
    };

    if (this.onCapture) {
      await this.onCapture(lead);
    }

    return {
      success: true,
      data: lead,
      message: 'Lead information captured successfully.',
    };
  }
}
