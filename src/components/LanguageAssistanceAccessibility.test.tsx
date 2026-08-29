import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LANGUAGE_ASSISTANCE_FIXTURES } from '../language/languageAssistanceConformance';
import { SourceWorkspace } from './SourceWorkspace';

afterEach(cleanup);

describe('language assistance accessibility conformance', () => {
  it.each(LANGUAGE_ASSISTANCE_FIXTURES.filter((fixture) => fixture.dimensions.accessibility.state === 'supported'))('$label exposes the shared keyboard and screen-reader editor contract', (fixture) => {
    render(<SourceWorkspace
      files={[fixture.file]}
      activeFileId={fixture.file.id}
      processor={fixture.processor}
      languageTarget={fixture.target}
      onSelectFile={() => undefined}
      onChange={() => undefined}
      onNewFile={() => undefined}
      onRenameFile={() => undefined}
      onDeleteFile={() => undefined}
      onDownloadFile={() => undefined}
      onSave={() => undefined}
      onCaretChange={() => undefined}
      onNotice={() => undefined}
    />);
    const editor = screen.getByRole('textbox', { name: `Edit ${fixture.file.name}` });
    expect(editor).toHaveAttribute('aria-autocomplete', 'list');
    expect(editor).toHaveAttribute('aria-controls', 'source-command-completion');
    expect(editor).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('Control+Space'));
    expect(screen.getByRole('complementary', { name: 'Source outline' })).toBeVisible();
    expect(screen.getByLabelText('Line numbers, source bookmarks and breakpoints')).toBeVisible();
  });
});
