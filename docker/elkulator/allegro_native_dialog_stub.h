/* Allegro's native-dialog addon, declared but not implemented.
 *
 * Allegro has no native-dialog backend for SDL, so the addon builds no library
 * at all on this platform — the linker simply cannot find it. That is not a
 * gap to be filled: a native file chooser and a native menu bar are the host
 * operating system's furniture, and a page has neither. The IDE supplies its
 * own file handling and its own menus, exactly as it does for the Archimedes
 * core, so Elkulator's menu layer has nothing to draw and nothing to ask.
 *
 * Every entry point Elkulator uses is declared here and answers in the way its
 * caller already handles when a dialog is refused: no menu, no chooser, no
 * selection. Nothing pretends to have succeeded.
 */
#ifndef WEBIDE_ALLEGRO_NATIVE_DIALOG_STUB_H
#define WEBIDE_ALLEGRO_NATIVE_DIALOG_STUB_H

#include <allegro5/allegro.h>

typedef struct ALLEGRO_MENU ALLEGRO_MENU;
typedef struct ALLEGRO_FILECHOOSER ALLEGRO_FILECHOOSER;

#define ALLEGRO_MENU_ITEM_CHECKBOX            1
#define ALLEGRO_MENU_ITEM_CHECKED             2
#define ALLEGRO_MENU_ITEM_DISABLED            4
#define ALLEGRO_FILECHOOSER_FILE_MUST_EXIST   1
#define ALLEGRO_FILECHOOSER_SAVE              2

/* The event a menu click would post. Its value matches Allegro's own so that
 * it cannot collide with a real event type, and nothing here ever posts one —
 * the event loop simply never sees this case. */
#define ALLEGRO_EVENT_MENU_CLICK              40

static inline bool al_init_native_dialog_addon(void) { return true; }

static inline ALLEGRO_MENU *al_create_menu(void) { return NULL; }
static inline bool al_append_menu_item(ALLEGRO_MENU *m, char const *t, uint16_t i,
                                       int f, ALLEGRO_BITMAP *b, ALLEGRO_MENU *s)
{ (void)m; (void)t; (void)i; (void)f; (void)b; (void)s; return false; }
static inline bool al_set_display_menu(ALLEGRO_DISPLAY *d, ALLEGRO_MENU *m)
{ (void)d; (void)m; return false; }
static inline ALLEGRO_EVENT_SOURCE *al_get_default_menu_event_source(void) { return NULL; }
static inline int al_get_menu_item_flags(ALLEGRO_MENU *m, int i) { (void)m; (void)i; return -1; }
static inline bool al_set_menu_item_flags(ALLEGRO_MENU *m, int i, int f)
{ (void)m; (void)i; (void)f; return false; }

static inline ALLEGRO_FILECHOOSER *al_create_native_file_dialog(char const *p, char const *t,
                                                                char const *pat, int mode)
{ (void)p; (void)t; (void)pat; (void)mode; return NULL; }
static inline void al_destroy_native_file_dialog(ALLEGRO_FILECHOOSER *c) { (void)c; }
static inline bool al_show_native_file_dialog(ALLEGRO_DISPLAY *d, ALLEGRO_FILECHOOSER *c)
{ (void)d; (void)c; return false; }
static inline int al_get_native_file_dialog_count(const ALLEGRO_FILECHOOSER *c) { (void)c; return 0; }
static inline const char *al_get_native_file_dialog_path(const ALLEGRO_FILECHOOSER *c, size_t i)
{ (void)c; (void)i; return NULL; }

#endif
