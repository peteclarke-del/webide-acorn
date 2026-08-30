import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AdfsEntryEditor } from './AdfsEntryEditor';
import { parseAdfsCatalogue } from '../media/adfsCatalogue';
import { createAdfsEImage } from '../media/adfsImage';

afterEach(cleanup);

/* A real image from the product's own writer, so what the editor is asked to
 * change is a disc a machine would mount. */
const image = () => createAdfsEImage({
  title: 'PROOF', name: 'RunImage', filetype: 0xff8, executionAddress: 0x8000,
  bytes: new Uint8Array(512).fill(0x60),
}).image;

function open() {
  const bytes = image();
  const entry = parseAdfsCatalogue(bytes).entries[0]!;
  const props = { image: bytes, entry, onApplied: vi.fn(), onNotice: vi.fn(), onClose: vi.fn() };
  render(<AdfsEntryEditor {...props} />);
  return props;
}

describe('changing one ADFS entry', () => {
  it('says what it will and will not touch before anything is changed', () => {
    /* The restraint is the reason this is safe to offer at all, so it is on the
     * panel rather than left for someone to discover by finding out what the
     * buttons do not do. */
    open();
    expect(screen.getByRole('group', { name: /Edit \$\.RunImage/ })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is moved and no length changes/)).toBeInTheDocument();
    expect(screen.getByText(/has to be exported to keep the change/)).toBeInTheDocument();
  });

  it('applies a changed execution address and hands back a reparsed image', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText(/Execution address of/), { target: { value: '&00001234' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply to the open image/ }));

    expect(props.onApplied).toHaveBeenCalledTimes(1);
    const [nextImage, catalogue] = props.onApplied.mock.calls[0]!;
    expect(catalogue.entries[0].executionAddress).toBe(0x1234);
    expect(parseAdfsCatalogue(nextImage).entries[0]!.executionAddress).toBe(0x1234);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('refuses a name ADFS could not hold, and does not change the image', () => {
    const props = open();
    fireEvent.change(screen.getByLabelText(/Name of/), { target: { value: 'A.B' } });
    expect(screen.getByRole('button', { name: /Apply to the open image/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/path or wildcard character/);
    expect(props.onApplied).not.toHaveBeenCalled();
  });

  it('refuses an address that is not hexadecimal, saying what one looks like', () => {
    open();
    fireEvent.change(screen.getByLabelText(/Load address of/), { target: { value: 'not hex' } });
    expect(screen.getByRole('status')).toHaveTextContent(/eight hexadecimal digits/);
    expect(screen.getByRole('button', { name: /Apply to the open image/ })).toBeDisabled();
  });

  it('says so rather than rewriting the image when nothing was changed', () => {
    const props = open();
    fireEvent.click(screen.getByRole('button', { name: /Apply to the open image/ }));
    expect(props.onApplied).not.toHaveBeenCalled();
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringMatching(/Nothing about \$\.RunImage was changed/));
  });

  it('offers no address fields for a directory, because they mean nothing there', () => {
    const bytes = image();
    const entry = { ...parseAdfsCatalogue(bytes).entries[0]!, directory: true };
    render(<AdfsEntryEditor image={bytes} entry={entry} onApplied={vi.fn()} onNotice={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText(/Load address of/)).toBeNull();
    expect(screen.getAllByLabelText(/Name of/).length).toBeGreaterThan(0);
  });
});
