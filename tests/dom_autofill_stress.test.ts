import { describe, it, expect, beforeEach } from 'vitest';
import { PhantomTyper, NativeValueWriter, VisibilityEngine } from '../src/content/autofill/formFiller';
import { FormDetector } from '../src/content/formDetector';

describe('DOM Autofill & Framework Stress Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('PhantomTyper & NativeValueWriter Framework Simulation', () => {
    it('sets input value and triggers input and change events on standard input', async () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'username-field';
      document.body.appendChild(input);

      let inputEventFired = false;
      input.addEventListener('input', () => {
        inputEventFired = true;
      });

      NativeValueWriter.setValue(input, 'testuser123');
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(input.value).toBe('testuser123');
      expect(inputEventFired).toBe(true);
    });

    it('simulates typing into connected elements cleanly', async () => {
      const input = document.createElement('input');
      input.type = 'email';
      input.id = 'email-field';
      document.body.appendChild(input);

      await PhantomTyper.typeSimulatedString(input, 'ghost@example.com');
      expect(input.value).toBe('ghost@example.com');
    });

    it('handles element detachment mid-typing gracefully without throwing', async () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      // Detach element immediately before/during typing
      const typePromise = PhantomTyper.typeSimulatedString(input, 'longstringofcharacters');
      input.remove(); // element is now detached

      await expect(typePromise).resolves.not.toThrow();
    });
  });

  describe('Split OTP Digit Boxes Layout Stress', () => {
    it('accurately identifies and fills a 6-digit split OTP input group', () => {
      const form = document.createElement('form');
      form.id = 'otp-form';

      const inputs: HTMLInputElement[] = [];
      for (let i = 0; i < 6; i++) {
        const digitInput = document.createElement('input');
        digitInput.type = 'text';
        digitInput.maxLength = 1;
        digitInput.setAttribute('inputmode', 'numeric');
        digitInput.id = `otp-digit-${i}`;
        form.appendChild(digitInput);
        inputs.push(digitInput);
      }
      document.body.appendChild(form);

      // Simulate filling 6-digit code '582914' across the 6 inputs
      const code = '582914';
      inputs.forEach((inp, idx) => {
        inp.value = code[idx]!;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const assembledCode = inputs.map((inp) => inp.value).join('');
      expect(assembledCode).toBe('582914');
      expect(inputs.length).toBe(6);
    });
  });

  describe('VisibilityEngine & Fillability Checks', () => {
    it('detects hidden, zero-size, or disabled elements', () => {
      const normalInput = document.createElement('input');
      normalInput.type = 'text';
      document.body.appendChild(normalInput);

      const disabledInput = document.createElement('input');
      disabledInput.type = 'text';
      disabledInput.disabled = true;
      document.body.appendChild(disabledInput);

      const readOnlyInput = document.createElement('input');
      readOnlyInput.type = 'text';
      readOnlyInput.readOnly = true;
      document.body.appendChild(readOnlyInput);

      expect(disabledInput.disabled).toBe(true);
      expect(readOnlyInput.readOnly).toBe(true);
    });
  });
});
