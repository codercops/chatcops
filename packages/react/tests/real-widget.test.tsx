import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { ChatCops } from '../src/index.js';

describe('ChatCops with real widget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one .chatcops-root in StrictMode and none after unmounting', async () => {
    const { unmount } = render(
      <StrictMode>
        <ChatCops apiUrl="/api/chat" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll('.chatcops-root')).toHaveLength(1);
    });

    unmount();
    expect(document.querySelectorAll('.chatcops-root')).toHaveLength(0);
  });
});
