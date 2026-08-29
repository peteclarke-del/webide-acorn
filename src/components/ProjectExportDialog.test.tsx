import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectExportDialog } from './ProjectExportDialog';

describe('project export dialog', () => {
  it('excludes private bookmarks by default and requires an explicit inclusion choice', () => {
    const exportProject = vi.fn();
    render(<ProjectExportDialog open projectName="Game" projectBookmarkCount={2} privateBookmarkCount={1} preview={null} onClose={() => undefined} onExport={exportProject} />);
    expect(screen.getByText('Private content will be excluded')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Download bundle' }));
    expect(exportProject).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('checkbox', { name: /Include private bookmarks and notes/ }));
    expect(screen.getByText('Private content will be included')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Download bundle' }));
    expect(exportProject).toHaveBeenLastCalledWith(true);
  });
});
