import { useEffect, useState } from 'react';

/**
 * Whether a media query matches, kept current as the window changes.
 *
 * The workbench lays its panels beside the editor on a wide window and over it
 * on a narrow one. Which of those is happening decides whether a panel takes a
 * grid column, so the layout has to know it in React rather than only in CSS;
 * a stylesheet that hid a panel while the grid still reserved its column left
 * an empty stripe where the panel used to be.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try { return window.matchMedia(query).matches; } catch { return false; }
  });

  useEffect(() => {
    let list: MediaQueryList;
    try { list = window.matchMedia(query); } catch { return; }
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
