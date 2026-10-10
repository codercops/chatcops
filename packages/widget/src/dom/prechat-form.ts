import type { PreChatField } from '../widget.js';
import type { WidgetLocaleStrings } from '../i18n.js';

// Must match the userData value limit in packages/server/src/config.ts (chatRequestSchema).
const MAX_PRECHAT_FIELD_LENGTH = 500;

export interface PreChatFormOptions {
  title: string;
  subtitle: string;
  fields: PreChatField[];
  submitLabel: string;
  locale: WidgetLocaleStrings;
  onSubmit: (data: Record<string, string>) => void;
}

export class PreChatForm {
  private container: HTMLDivElement;
  private fieldElements = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  private errorElements = new Map<string, HTMLDivElement>();
  private submitBtn!: HTMLButtonElement;
  private options: PreChatFormOptions;

  constructor(parent: HTMLElement, options: PreChatFormOptions) {
    this.options = options;
    this.container = document.createElement('div');
    this.container.className = 'cc-prechat';

    if (options.title) {
      const title = document.createElement('div');
      title.className = 'cc-prechat-title';
      title.textContent = options.title;
      this.container.appendChild(title);
    }

    if (options.subtitle) {
      const subtitle = document.createElement('div');
      subtitle.className = 'cc-prechat-subtitle';
      subtitle.textContent = options.subtitle;
      this.container.appendChild(subtitle);
    }

    const form = document.createElement('form');
    form.className = 'cc-prechat-fields';
    form.noValidate = true;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    for (const field of options.fields) {
      form.appendChild(this.createField(field));
    }

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'submit';
    this.submitBtn.className = 'cc-prechat-submit';
    this.submitBtn.textContent = options.submitLabel;
    form.appendChild(this.submitBtn);

    this.container.appendChild(form);
    parent.appendChild(this.container);

    this.updateSubmitState();

    const firstInput = this.fieldElements.values().next().value;
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  private createField(field: PreChatField): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cc-prechat-field';

    const inputId = `cc-prechat-${field.name}`;
    const errorId = `cc-prechat-${field.name}-error`;

    const label = document.createElement('label');
    label.className = 'cc-prechat-label';
    label.htmlFor = inputId;
    label.textContent = field.label;
    if (field.required) {
      const req = document.createElement('span');
      req.className = 'cc-required';
      req.textContent = '*';
      label.appendChild(req);
    }
    wrapper.appendChild(label);

    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

    if (field.type === 'select') {
      const select = document.createElement('select');
      select.className = 'cc-prechat-select';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = field.placeholder ?? `Select ${field.label.toLowerCase()}...`;
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      select.appendChild(defaultOpt);
      for (const opt of field.options ?? []) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }
      input = select;
    } else if (field.type === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.className = 'cc-prechat-textarea';
      textarea.placeholder = field.placeholder ?? '';
      textarea.rows = 3;
      textarea.maxLength = MAX_PRECHAT_FIELD_LENGTH;
      input = textarea;
    } else {
      const textInput = document.createElement('input');
      textInput.type = field.type;
      textInput.className = 'cc-prechat-input';
      textInput.maxLength = MAX_PRECHAT_FIELD_LENGTH;
      textInput.placeholder = field.placeholder ?? '';
      input = textInput;
    }

    input.name = field.name;
    input.id = inputId;
    if (field.required) {
      input.setAttribute('aria-required', 'true');
    }
    input.addEventListener('input', () => {
      this.clearError(field.name);
      this.updateSubmitState();
    });
    if (input instanceof HTMLSelectElement) {
      input.addEventListener('change', () => {
        this.clearError(field.name);
        this.updateSubmitState();
      });
    }
    wrapper.appendChild(input);
    this.fieldElements.set(field.name, input);

    const error = document.createElement('div');
    error.className = 'cc-prechat-error';
    error.id = errorId;
    wrapper.appendChild(error);
    this.errorElements.set(field.name, error);

    return wrapper;
  }

  private updateSubmitState(): void {
    const allRequiredFilled = this.options.fields.every((field) => {
      if (!field.required) return true;
      const el = this.fieldElements.get(field.name);
      return el ? el.value.trim().length > 0 : false;
    });
    this.submitBtn.disabled = !allRequiredFilled;
  }

  private handleSubmit(): void {
    const data: Record<string, string> = {};
    let valid = true;

    for (const field of this.options.fields) {
      const el = this.fieldElements.get(field.name);
      if (!el) continue;
      const value = el.value.trim();
      data[field.name] = value;

      if (field.required && !value) {
        this.showError(field.name, this.options.locale.preChatRequired);
        valid = false;
        continue;
      }

      if (field.type === 'email' && value && !this.isValidEmail(value)) {
        this.showError(field.name, this.options.locale.preChatInvalidEmail);
        valid = false;
        continue;
      }
    }

    if (valid) {
      this.options.onSubmit(data);
    }
  }

  private showError(fieldName: string, message: string): void {
    const el = this.errorElements.get(fieldName);
    if (el) el.textContent = message;
    const fieldEl = this.fieldElements.get(fieldName);
    if (fieldEl && el) {
      fieldEl.setAttribute('aria-invalid', 'true');
      fieldEl.setAttribute('aria-describedby', el.id);
    }
  }

  private clearError(fieldName: string): void {
    const el = this.errorElements.get(fieldName);
    if (el) el.textContent = '';
    const fieldEl = this.fieldElements.get(fieldName);
    if (fieldEl && el) {
      if (fieldEl.getAttribute('aria-describedby') === el.id) {
        fieldEl.removeAttribute('aria-describedby');
      }
      if (fieldEl.getAttribute('aria-invalid') === 'true') {
        fieldEl.removeAttribute('aria-invalid');
      }
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  destroy(): void {
    this.container.remove();
    this.fieldElements.clear();
    this.errorElements.clear();
  }
}
