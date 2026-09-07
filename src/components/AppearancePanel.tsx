/* Where a person changes how the workbench looks.
 *
 * Both settings here existed in the stylesheet and neither could be reached
 * from the product: the light theme had never been rendered, and the type-scale
 * multiplier its own comment describes as the thing "a person can raise" had no
 * control to raise it. This is that control.
 *
 * The change is applied as it is made rather than on a Save button, because
 * both are choices about legibility and the only way to judge one is to see it.
 */
import { useId } from 'react';
import { Icon } from './Icon';
import { THEME_CHOICES, CONTRAST_CHOICES, TEXT_SIZES, floorForScale, type Appearance, type ContrastChoice, type ThemeChoice } from '../theme/appearance';

interface AppearancePanelProps {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

export function AppearancePanel({ appearance, onChange }: AppearancePanelProps) {
  const themeId = useId();
  const contrastId = useId();
  const sizeId = useId();
  const current = TEXT_SIZES.find((size) => size.scale === appearance.scale);

  return (
    <section className="appearance-panel panel-surface" aria-label="Appearance">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">HOW THIS WORKBENCH LOOKS</span>
          <h2>Appearance</h2>
        </div>
        <small>{current?.label ?? 'Custom'}</small>
      </div>
      <p className="binding-note">
        Both settings apply immediately and are remembered on this computer. Text size scales the whole interface
        rather than one kind of label, so nothing ends up larger than the thing it belongs to.
      </p>

      <div className="appearance-fields">
        <label htmlFor={themeId}>
          <span><Icon name="screen" size={13} /> Theme</span>
          <select
            id={themeId}
            value={appearance.theme}
            onChange={(event) => onChange({ ...appearance, theme: event.target.value as ThemeChoice })}
          >
            {THEME_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
          <small>{THEME_CHOICES.find((choice) => choice.id === appearance.theme)?.description}</small>
        </label>

        <label htmlFor={contrastId}>
          <span><Icon name="layers" size={13} /> Contrast</span>
          <select
            id={contrastId}
            value={appearance.contrast}
            onChange={(event) => onChange({ ...appearance, contrast: event.target.value as ContrastChoice })}
          >
            {CONTRAST_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
          <small>{CONTRAST_CHOICES.find((choice) => choice.id === appearance.contrast)?.description}</small>
        </label>

        <label htmlFor={sizeId}>
          <span><Icon name="settings" size={13} /> Text size</span>
          <select
            id={sizeId}
            value={String(appearance.scale)}
            onChange={(event) => onChange({ ...appearance, scale: Number(event.target.value) })}
          >
            {TEXT_SIZES.map((size) => <option key={size.scale} value={String(size.scale)}>{size.label}</option>)}
          </select>
          <small>
            Every size is multiplied by {appearance.scale.toFixed(2)}, and nothing is drawn below {floorForScale(appearance.scale)}px.
          </small>
        </label>
      </div>
    </section>
  );
}
