import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AppearancePanel } from './AppearancePanel';
import { CONTRAST_CHOICES, DEFAULT_APPEARANCE, TEXT_SIZES, THEME_CHOICES } from '../theme/appearance';

afterEach(cleanup);

/*
 * The control that makes the light theme and the type scale reachable.
 *
 * Both settings existed in the stylesheet and neither had anywhere to be
 * chosen, which is how the light theme went unrendered long enough to inherit
 * the dark theme's foreground colours. A panel that offered fewer choices than
 * the stylesheet can produce would put part of it back out of reach, so the
 * options are checked against the module that defines them rather than listed
 * again here.
 */
describe('the appearance panel', () => {
  it('offers every theme, contrast and text size the build supports', () => {
    /* Each list is read inside its own control: theme and contrast both offer
     * "Match the system", so looking across the whole panel finds two. */
    render(<AppearancePanel appearance={DEFAULT_APPEARANCE} onChange={() => {}} />);
    const theme = screen.getByLabelText(/Theme/i);
    expect(within(theme).getAllByRole('option').map((option) => option.textContent))
      .toEqual(THEME_CHOICES.map((choice) => choice.label));
    expect(theme).toHaveValue(DEFAULT_APPEARANCE.theme);

    const contrast = screen.getByLabelText(/Contrast/i);
    expect(within(contrast).getAllByRole('option').map((option) => option.textContent))
      .toEqual(CONTRAST_CHOICES.map((choice) => choice.label));
    expect(contrast).toHaveValue(DEFAULT_APPEARANCE.contrast);

    const size = screen.getByLabelText(/Text size/i);
    expect(within(size).getAllByRole('option').map((option) => option.textContent))
      .toEqual(TEXT_SIZES.map((entry) => entry.label));
  });

  it('reports a contrast change as the choice', () => {
    const onChange = vi.fn();
    render(<AppearancePanel appearance={DEFAULT_APPEARANCE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Contrast/i), { target: { value: 'more' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, contrast: 'more' });
  });

  it('reports a theme change as the choice, not as a label', () => {
    const onChange = vi.fn();
    render(<AppearancePanel appearance={DEFAULT_APPEARANCE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Theme/i), { target: { value: 'light' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, theme: 'light' });
  });

  it('reports a size change as a number, because it is a multiplier', () => {
    const onChange = vi.fn();
    render(<AppearancePanel appearance={DEFAULT_APPEARANCE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Text size/i), { target: { value: '1.75' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, scale: 1.75 });
  });

  it('says what the current size actually does, in numbers a person can check', () => {
    render(<AppearancePanel appearance={{ theme: 'light', contrast: 'more', scale: 2 }} onChange={() => {}} />);
    expect(screen.getByText(/multiplied by 2\.00/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is drawn below 23\.1px/)).toBeInTheDocument();
  });

  it('is a labelled region, so it can be reached from a landmark list', () => {
    render(<AppearancePanel appearance={DEFAULT_APPEARANCE} onChange={() => {}} />);
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
  });
});
