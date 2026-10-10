import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreChatForm } from '../../src/dom/prechat-form.js';
import type { PreChatField } from '../../src/widget.js';
import { getWidgetLocale } from '../../src/i18n.js';

const locale = getWidgetLocale('en');

function makeFields(overrides: Partial<PreChatField>[] = []): PreChatField[] {
  const defaults: PreChatField[] = [
    { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Your name' },
    { name: 'email', type: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { name: 'topic', type: 'select', label: 'Topic', required: false, options: ['Sales', 'Support', 'Other'] },
    { name: 'message', type: 'textarea', label: 'Message', required: false, placeholder: 'How can we help?' },
  ];
  return overrides.length > 0
    ? overrides.map((o, i) => ({ ...defaults[i % defaults.length], ...o }) as PreChatField)
    : defaults;
}

function createForm(
  parent: HTMLDivElement,
  fieldOverrides: Partial<PreChatField>[] = [],
  onSubmit = vi.fn(),
) {
  return new PreChatForm(parent, {
    title: 'Before we start...',
    subtitle: 'Tell us about yourself',
    fields: makeFields(fieldOverrides),
    submitLabel: 'Start Chat',
    locale,
    onSubmit,
  });
}

describe('PreChatForm', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  describe('field rendering', () => {
    it('limits text inputs and textareas to 500 characters', () => {
      createForm(parent);

      const textInput = parent.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement;
      const emailInput = parent.querySelector(
        'input[name="email"]',
      ) as HTMLInputElement;
      const textarea = parent.querySelector(
        'textarea[name="message"]',
      ) as HTMLTextAreaElement;

      expect(textInput.maxLength).toBe(500);
      expect(emailInput.maxLength).toBe(500);
      expect(textarea.maxLength).toBe(500);
    });

    it('renders title and subtitle', () => {
      createForm(parent);
      expect(parent.querySelector('.cc-prechat-title')?.textContent).toBe('Before we start...');
      expect(parent.querySelector('.cc-prechat-subtitle')?.textContent).toBe('Tell us about yourself');
    });

    it('renders all field types', () => {
      createForm(parent);
      expect(parent.querySelector('input[type="text"]')).toBeTruthy();
      expect(parent.querySelector('input[type="email"]')).toBeTruthy();
      expect(parent.querySelector('select')).toBeTruthy();
      expect(parent.querySelector('textarea')).toBeTruthy();
    });

    it('renders required markers on required fields', () => {
      createForm(parent);
      const labels = parent.querySelectorAll('.cc-prechat-label');
      const nameLabel = labels[0];
      const emailLabel = labels[1];
      const topicLabel = labels[2];

      expect(nameLabel.querySelector('.cc-required')).toBeTruthy();
      expect(emailLabel.querySelector('.cc-required')).toBeTruthy();
      expect(topicLabel.querySelector('.cc-required')).toBeNull();
    });

    it('renders select options including disabled placeholder', () => {
      createForm(parent);
      const select = parent.querySelector('select') as HTMLSelectElement;
      const options = select.querySelectorAll('option');
      expect(options.length).toBe(4); // placeholder + 3 options
      expect(options[0].disabled).toBe(true);
      expect(options[0].selected).toBe(true);
      expect(options[1].textContent).toBe('Sales');
    });

    it('renders submit button', () => {
      createForm(parent);
      const btn = parent.querySelector('.cc-prechat-submit') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe('Start Chat');
    });
  });

  describe('required field validation', () => {
    it('shows error for empty required fields on submit', () => {
      const onSubmit = vi.fn();
      createForm(parent, [], onSubmit);

      const btn = parent.querySelector('.cc-prechat-submit') as HTMLButtonElement;
      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const errors = parent.querySelectorAll('.cc-prechat-error');
      const nameError = errors[0];
      expect(nameError.textContent).toBe('This field is required');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('clears error on input', () => {
      createForm(parent);

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const nameError = parent.querySelectorAll('.cc-prechat-error')[0];
      expect(nameError.textContent).toBe('This field is required');

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      expect(nameError.textContent).toBe('');
    });

    it('disables submit when required fields are empty', () => {
      createForm(parent);
      const btn = parent.querySelector('.cc-prechat-submit') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it('enables submit when all required fields are filled', () => {
      createForm(parent);

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      expect((parent.querySelector('.cc-prechat-submit') as HTMLButtonElement).disabled).toBe(true);

      emailInput.value = 'alice@example.com';
      emailInput.dispatchEvent(new Event('input'));
      expect((parent.querySelector('.cc-prechat-submit') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('email validation', () => {
    it('shows error for invalid email on submit', () => {
      const onSubmit = vi.fn();
      createForm(parent, [], onSubmit);

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      emailInput.value = 'not-an-email';
      emailInput.dispatchEvent(new Event('input'));

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const errors = parent.querySelectorAll('.cc-prechat-error');
      const emailError = errors[1];
      expect(emailError.textContent).toBe('Please enter a valid email');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('accepts valid email format', () => {
      const onSubmit = vi.fn();
      createForm(parent, [], onSubmit);

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      emailInput.value = 'alice@example.com';
      emailInput.dispatchEvent(new Event('input'));

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Alice',
        email: 'alice@example.com',
      }));
    });
  });

  describe('accessibility', () => {
    it('associates every label with its field via htmlFor and unique stable ids', () => {
      createForm(parent);
      const controls = parent.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        '.cc-prechat-input, .cc-prechat-select, .cc-prechat-textarea',
      );
      const labels = parent.querySelectorAll<HTMLLabelElement>('.cc-prechat-label');
      const ids = new Set<string>();

      expect(controls.length).toBe(4);
      expect(labels.length).toBe(controls.length);

      controls.forEach((control) => {
        expect(control.id).toBe(`cc-prechat-${control.name}`);
        expect(ids.has(control.id)).toBe(false);
        ids.add(control.id);
      });

      labels.forEach((label) => {
        const control = document.getElementById(label.htmlFor);
        expect(control).toBeTruthy();
        expect(control?.tagName).toMatch(/INPUT|SELECT|TEXTAREA/);
      });
    });

    it('sets aria-required on required fields only', () => {
      createForm(parent);
      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;
      const topicSelect = parent.querySelector('select[name="topic"]') as HTMLSelectElement;
      const messageTextarea = parent.querySelector('textarea[name="message"]') as HTMLTextAreaElement;

      expect(nameInput.getAttribute('aria-required')).toBe('true');
      expect(emailInput.getAttribute('aria-required')).toBe('true');
      expect(topicSelect.hasAttribute('aria-required')).toBe(false);
      expect(messageTextarea.hasAttribute('aria-required')).toBe(false);
    });

    it('associates an error with its field via aria-invalid and aria-describedby', () => {
      createForm(parent);

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const nameError = parent.querySelectorAll('.cc-prechat-error')[0];
      expect(nameError.id).toBeTruthy();
      expect(nameInput.getAttribute('aria-invalid')).toBe('true');
      expect(nameInput.getAttribute('aria-describedby')).toBe(nameError.id);
      expect(document.getElementById(nameError.id)).toBe(nameError);
      expect(nameError.textContent).toBe('This field is required');
    });

    it('removes error attributes on input without removing unrelated accessibility attributes', () => {
      createForm(parent);

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      nameInput.setAttribute('aria-live', 'polite');
      expect(nameInput.getAttribute('aria-invalid')).toBe('true');

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));

      expect(nameInput.hasAttribute('aria-invalid')).toBe(false);
      expect(nameInput.hasAttribute('aria-describedby')).toBe(false);
      expect(nameInput.getAttribute('aria-live')).toBe('polite');
    });

    it('keeps unrelated aria-describedby when clearing a field without an error', () => {
      createForm(parent);

      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;
      emailInput.setAttribute('aria-describedby', 'external-hint');
      emailInput.dispatchEvent(new Event('input'));

      expect(emailInput.getAttribute('aria-describedby')).toBe('external-hint');
      expect(emailInput.hasAttribute('aria-invalid')).toBe(false);
    });

    it('disables native validation with noValidate so widget messages are shown', () => {
      const onSubmit = vi.fn();
      createForm(parent, [], onSubmit);

      const form = parent.querySelector('form') as HTMLFormElement;
      expect(form.noValidate).toBe(true);

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;
      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      emailInput.value = 'not-an-email';
      emailInput.dispatchEvent(new Event('input'));

      form.dispatchEvent(new Event('submit', { cancelable: true }));

      const emailError = parent.querySelectorAll('.cc-prechat-error')[1];
      expect(emailError.textContent).toBe('Please enter a valid email');
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('form submission', () => {
    it('calls onSubmit with all field values', () => {
      const onSubmit = vi.fn();
      createForm(parent, [], onSubmit);

      const nameInput = parent.querySelector('input[name="name"]') as HTMLInputElement;
      const emailInput = parent.querySelector('input[name="email"]') as HTMLInputElement;
      const select = parent.querySelector('select[name="topic"]') as HTMLSelectElement;
      const textarea = parent.querySelector('textarea[name="message"]') as HTMLTextAreaElement;

      nameInput.value = 'Alice';
      nameInput.dispatchEvent(new Event('input'));
      emailInput.value = 'alice@example.com';
      emailInput.dispatchEvent(new Event('input'));
      select.value = 'Support';
      select.dispatchEvent(new Event('change'));
      textarea.value = 'Need help with billing';
      textarea.dispatchEvent(new Event('input'));

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));

      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Alice',
        email: 'alice@example.com',
        topic: 'Support',
        message: 'Need help with billing',
      });
    });
  });

  describe('show/skip logic', () => {
    it('skips title when empty string', () => {
      new PreChatForm(parent, {
        title: '',
        subtitle: '',
        fields: makeFields(),
        submitLabel: 'Go',
        locale,
        onSubmit: vi.fn(),
      });
      expect(parent.querySelector('.cc-prechat-title')).toBeNull();
      expect(parent.querySelector('.cc-prechat-subtitle')).toBeNull();
    });

    it('renders form with only optional fields (submit enabled by default)', () => {
      const onSubmit = vi.fn();
      new PreChatForm(parent, {
        title: 'Optional form',
        subtitle: '',
        fields: [
          { name: 'note', type: 'text', label: 'Note', required: false },
        ],
        submitLabel: 'Continue',
        locale,
        onSubmit,
      });

      const btn = parent.querySelector('.cc-prechat-submit') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);

      const form = parent.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(onSubmit).toHaveBeenCalledWith({ note: '' });
    });
  });

  describe('destroy', () => {
    it('removes the form from DOM', () => {
      const form = createForm(parent);
      expect(parent.querySelector('.cc-prechat')).toBeTruthy();
      form.destroy();
      expect(parent.querySelector('.cc-prechat')).toBeNull();
    });
  });
});
