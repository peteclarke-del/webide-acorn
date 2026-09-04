import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

/* A menu bar for a panel's own actions.
 *
 * Every workspace carried its actions as a row of buttons, and the asset
 * editors carried fifteen of them above a sixteen-pixel canvas. The buttons
 * were not the problem — each one is a thing somebody does — but a row is the
 * most expensive way to offer them: it spends the width of the panel and the
 * height of a control on things that are used once a session, in front of the
 * work itself.
 *
 * This is the menubar pattern rather than a set of disclosure buttons, because
 * that is what it is: one tab stop for the whole bar, left and right between
 * menus, down into one, Escape back out. A reader who has met a menu bar
 * anywhere else already knows how to drive this one.
 */

export interface PanelMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown after the label: a shortcut, or what the action will produce. */
  hint?: string;
  /** Present when this item is one of a set of alternatives, and its state. */
  checked?: boolean;
  /** A rule above this item, for a group inside one menu. */
  separated?: boolean;
}

export interface PanelMenu {
  id: string;
  label: string;
  items: PanelMenuItem[];
}

export interface PanelMenuBarProps {
  /** Names the bar for anyone who cannot see which panel it belongs to. */
  label: string;
  menus: PanelMenu[];
}

export function PanelMenuBar({ label, menus }: PanelMenuBarProps) {
  const offered = menus.filter((menu) => menu.items.length > 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  /* A menu that stays open when the pointer goes elsewhere is a menu that eats
   * the next click somebody makes. */
  useEffect(() => {
    if (!openId) return;
    const dismiss = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setOpenId(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    itemsRef.current?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')?.focus();
  }, [openId]);

  if (!offered.length) return null;

  const focus = (index: number) => {
    const next = (index + offered.length) % offered.length;
    setFocused(next);
    barRef.current?.querySelectorAll<HTMLElement>('[data-menu-button]')[next]?.focus();
  };

  const onBarKey = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const key = event.key;
    if (key === 'ArrowRight') { event.preventDefault(); setOpenId(null); focus(index + 1); return; }
    if (key === 'ArrowLeft') { event.preventDefault(); setOpenId(null); focus(index - 1); return; }
    if (key === 'Home') { event.preventDefault(); setOpenId(null); focus(0); return; }
    if (key === 'End') { event.preventDefault(); setOpenId(null); focus(offered.length - 1); return; }
    if (key === 'ArrowDown' || key === 'Enter' || key === ' ') { event.preventDefault(); setOpenId(offered[index]!.id); return; }
    if (key === 'Escape') { setOpenId(null); }
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    const buttons = [...(itemsRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); return; }
    if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus(); return; }
    if (event.key === 'End') { event.preventDefault(); buttons[buttons.length - 1]?.focus(); return; }
    if (event.key === 'Escape') { event.preventDefault(); setOpenId(null); focus(index); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); setOpenId(null); focus(index + 1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); setOpenId(null); focus(index - 1); return; }
  };

  return (
    <div className="panel-menu-bar" role="menubar" aria-label={label} ref={barRef}>
      {offered.map((menu, index) => (
        <div className="panel-menu" key={menu.id}>
          <button
            type="button"
            data-menu-button
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={openId === menu.id}
            tabIndex={index === focused ? 0 : -1}
            className={openId === menu.id ? 'panel-actions-button open' : 'panel-actions-button'}
            onClick={() => { setFocused(index); setOpenId((current) => current === menu.id ? null : menu.id); }}
            onKeyDown={(event) => onBarKey(event, index)}
          >
            {menu.label}
          </button>
          {openId === menu.id && (
            <div className="panel-menu-items" role="menu" aria-label={menu.label} ref={itemsRef} onKeyDown={(event) => onMenuKey(event, index)}>
              {menu.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
                  className={item.separated ? 'panel-menu-item separated' : 'panel-menu-item'}
                  disabled={item.disabled}
                  onClick={() => { setOpenId(null); item.onSelect(); }}
                >
                  <span>{item.label}</span>
                  {item.hint && <small>{item.hint}</small>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
