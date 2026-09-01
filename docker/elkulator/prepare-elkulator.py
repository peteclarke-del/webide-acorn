import io, re, os
# ALUT has no Emscripten port and Elkulator uses two of its functions, so the
# configure check goes and a shim stands in for them.
p = '/elkulator/configure.ac'
s = io.open(p, encoding='utf-8').read()
s = s.replace("""AC_CHECK_LIB([alut], [alutInit], [], \\
   [echo "You need to install the ALUT library."
    exit -1])""", "# ALUT: supplied by webide_alut_shim.h under Emscripten.")
io.open(p, 'w', encoding='utf-8').write(s)

# The shim replaces the ALUT header wherever it is included.
for root, _dirs, files in os.walk('/elkulator/src'):
    for name in files:
        if not name.endswith(('.c', '.h')):
            continue
        path = os.path.join(root, name)
        body = io.open(path, encoding='utf-8', errors='replace').read()
        if '<AL/alut.h>' in body:
            io.open(path, 'w', encoding='utf-8').write(body.replace('#include <AL/alut.h>', '#include "webide_alut_shim.h"'))
            print('shimmed', path)

# The build files still name ALUT even though the configure check is gone, and
# Emscripten has no such library. The shim replaced the two functions it
# provided, so nothing is lost by dropping the flag.
import glob
for makefile in glob.glob('/elkulator/Makefile.am') + glob.glob('/elkulator/src/Makefile.am'):
    body = io.open(makefile, encoding='utf-8').read()
    if '-lalut' in body:
        io.open(makefile, 'w', encoding='utf-8').write(body.replace('-lalut', ''))
        print('dropped -lalut from', makefile)

# The blocking wait, and the loop that cannot survive it.
#
# `al_wait_for_event` does not return until something arrives, and a page that
# is inside it is a page that never paints. The first attempt at this expressed
# the same wait as a poll that yields — `emscripten_sleep` handing control back
# and ASYNCIFY resuming the C stack where it left off — and that half worked:
# instrumenting both sides showed `event_await` called two hundred times and
# returning two hundred times with a synthesised timer event, and the statement
# immediately after `elkEvent = event_await()` in `main` never executing.
#
# ASYNCIFY cannot carry this loop. On rewind, execution resumes inside the frame
# that unwound and returns from it, but `main`'s frame was never saved, so
# control goes back to the runtime rather than into the loop body — which is why
# `event_await` was re-entered from the top for ever. `-sASYNCIFY_ADD=["main"]`
# does not help: Allegro's main addon renames the program's `main`, so the name
# in the list matches nothing.
#
# So the loop is turned inside out instead. `event_await` returns whether or not
# anything has happened, `main` hands its body to `emscripten_set_main_loop`,
# and no C stack is ever unwound — which takes ASYNCIFY out of the build
# entirely along with its 500 KB. It is also what the IDE integration wants,
# since the IDE decides when the machine steps.
handler = '/elkulator/src/host_abstraction_layer/allegro_5/event_handler.c'
body = io.open(handler, encoding='utf-8').read()

# emscripten_get_now and the main-loop calls live here.
if '#include <emscripten.h>' not in body:
    body = body.replace('#include <allegro5/allegro.h>',
                        '#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif\n#include <allegro5/allegro.h>', 1)

old_await = """// Main event handling Code
uint32_t event_await()
{
    ALLEGRO_EVENT event;
    elk_event_t elkEvent = 0;

    while (!elkEvent) 
    {
        al_wait_for_event(queue, &event);

        // Handle main events."""
assert old_await in body, 'event_await changed shape; the browser port needs revisiting'

# The dispatch is lifted out unchanged so that both the native wait and the
# browser poll run exactly the same code over an event.
new_await = """// Dispatch one event to whichever handler claims it.
//
// Lifted out of event_await so that the browser poll below and the native wait
// run identical code over an event rather than two copies that can drift.
static elk_event_t webide_dispatch_event(ALLEGRO_EVENT * event)
{
    elk_event_t elkEvent = 0;
    uint16_t count = 0;
    while(count < registered_handlers && !(elkEvent & ELK_EVENT_HANDLED))
    {
        if(event->type == callback_event_handler_list[count].event_id)
        {
            // Handler for the event found.
            elkEvent = callback_event_handler_list[count].handler_function(event);
            elkEvent |= ELK_EVENT_HANDLED;
        }
        count++;
    }
    return elkEvent;
}

// Main event handling Code
uint32_t event_await()
{
    ALLEGRO_EVENT event;
    elk_event_t elkEvent = 0;

#ifdef __EMSCRIPTEN__
    /* One pass, and never a wait. See prepare-elkulator.py: the browser calls
     * the loop body one iteration at a time, so this has to return whether or
     * not anything has happened, and ELK_EVENT_NONE is a perfectly ordinary
     * answer that the loop body does nothing with. */
    {
        static double webide_next_tick_ms = 0;
        double now_ms;

        /* Everything the backend has delivered since the last iteration is
         * taken now. Draining one event per browser frame would make the
         * keyboard as slow as the display. */
        while (al_get_next_event(queue, &event))
        {
            elkEvent |= webide_dispatch_event(&event);
        }

        /* The 50 Hz tick that Allegro's SDL backend registers an event source
         * for and then never posts to, because it has no thread to tick it
         * from. It is supplied here from the clock the browser does have. This
         * is a platform service the backend does not implement rather than
         * emulator state being invented: the event carries nothing beyond
         * "20 ms passed", which is what the real timer would have said. */
        now_ms = emscripten_get_now();
        if (now_ms >= webide_next_tick_ms)
        {
            /* Never more than one frame behind. Catching up after a long pause
             * would run the machine flat out for as many frames as elapsed
             * rather than resuming it at real speed. */
            webide_next_tick_ms = now_ms + 20.0;
            elkEvent |= ELK_EVENT_HANDLED | ELK_EVENT_TIMER_TRIGGERED;
        }
    }
#else
    while (!elkEvent) 
    {
        al_wait_for_event(queue, &event);

        elkEvent = webide_dispatch_event(&event);"""
body = body.replace(old_await, new_await, 1)

# What is left of the old inline dispatch is now dead, and the native branch has
# to be closed. The tail of the function is rewritten in one piece rather than
# unpicked line by line.
old_tail = """        uint16_t count = 0;
        while(count < registered_handlers && !(elkEvent & ELK_EVENT_HANDLED))
        {
            if(event.type == callback_event_handler_list[count].event_id)
            {
                // Handler for the event found.
                elkEvent = callback_event_handler_list[count].handler_function(&event);
                elkEvent |= ELK_EVENT_HANDLED;
            }
            count++;
        }

        if(!(elkEvent & ELK_EVENT_HANDLED))
        {
            log_debug("event_await: event %d handled", event.type);
        }
        else if(!(elkEvent & ELK_EVENT_HANDLED) && (event.type != ALLEGRO_EVENT_TIMER))
        {
            log_debug("event_await: event %d detected", event.type);
        }
    }
"""
new_tail = """        if(!(elkEvent & ELK_EVENT_HANDLED))
        {
            log_debug("event_await: event %d handled", event.type);
        }
    }
#endif
"""
assert old_tail in body, 'the event_await tail changed shape; the browser port needs revisiting'
body = body.replace(old_tail, new_tail, 1)
io.open(handler, 'w', encoding='utf-8').write(body)
print('event_await polls and yields to the browser, and supplies the 50 Hz tick')

# The loop itself, handed to the browser.
#
# `emscripten_set_main_loop` calls one iteration at a time, so the body of the
# loop becomes a function and every local it held becomes a file-scope static:
# nothing on main's stack has to survive between iterations any more, which is
# precisely the thing ASYNCIFY could not arrange. The body is moved rather than
# rewritten, so what runs in a browser is upstream's loop character for
# character.
main_c = '/elkulator/src/main.c'
body = io.open(main_c, encoding='utf-8').read()

if '#include <emscripten.h>' not in body:
    body = body.replace('#include <stdio.h>', '#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif\n#include <stdio.h>', 1)

declarations = """        char elk_timediff_str[28];
        char elk_cumulated_timediff_str[28];
        elk_event_t elkEvent = 0;
        native_timediff_t elk_runtime = 0;
        native_timediff_t native_timer_diff = 0;
        native_timediff_t native_cummulative_time_diff = 0;
        native_timestamp_t native_timestamp_last_trigger = native_timestamp_get();
        native_timestamp_t native_timestamp_current = 0;
"""
open_loop = """        while (!(elkEvent & ELK_EVENT_EXIT))
        {
"""
close_loop = """        }
    #endif // HAL_ALLEGRO_4"""
assert declarations in body, "main's loop variables changed; the browser port needs revisiting"
assert open_loop in body and close_loop in body, "main's loop changed shape; the browser port needs revisiting"
loop_start = body.index(open_loop) + len(open_loop)
loop_end = body.index(close_loop)
loop_body = body[loop_start:loop_end].rstrip('\n')

# `count` is declared at the top of main and read only by the loop body, so it
# moves with the rest of them.
old_count = '    int count = 0;\n'
assert old_count in body, "main's count declaration moved; the browser port needs revisiting"
body = body.replace(old_count, '#ifndef __EMSCRIPTEN__\n' + old_count + '#endif\n', 1)

iteration = """#ifdef __EMSCRIPTEN__
/* The loop body, as a function the browser calls one iteration at a time.
 *
 * See docker/elkulator/prepare-elkulator.py. Every local the body held lives
 * here instead, because this function returns between iterations rather than
 * looping. They are static, so they are private to this file and cannot
 * collide with anything; inside main they are shadowed by the identically
 * named locals the native loop still declares for itself.
 */
static int count = 0;
static char elk_timediff_str[28];
static char elk_cumulated_timediff_str[28];
static elk_event_t elkEvent = 0;
static native_timediff_t elk_runtime = 0;
static native_timediff_t native_timer_diff = 0;
static native_timediff_t native_cummulative_time_diff = 0;
static native_timestamp_t native_timestamp_last_trigger = 0;
static native_timestamp_t native_timestamp_current = 0;

static void webide_main_iteration(void)
{
    if (elkEvent & ELK_EVENT_EXIT)
    {
        /* The close button, or the IDE asking the machine to stop. There is no
         * unwinding out of a browser main loop, so it is cancelled here and the
         * shutdown that used to follow the native loop is run in its place. */
        emscripten_cancel_main_loop();
        closeelk();
        log_info("Elkulator has ended");
        return;
    }

""" + loop_body + """
}
#endif // __EMSCRIPTEN__

"""

anchor = 'int main(int argc, char **argv)'
assert anchor in body, "main's signature changed; the browser port needs revisiting"
body = body.replace(anchor, iteration + anchor, 1)

replacement = """#ifdef __EMSCRIPTEN__
        native_timestamp_last_trigger = native_timestamp_get();
        /* Never returns: the browser owns the loop from here, and calls
         * webide_main_iteration once per frame. */
        emscripten_set_main_loop(webide_main_iteration, 0, 1);
#else
""" + declarations + open_loop + loop_body + """
        }
#endif // __EMSCRIPTEN__
    #endif // HAL_ALLEGRO_4"""
original_loop = declarations + open_loop + loop_body + '\n' + close_loop
assert original_loop in body, "main's loop could not be located to replace"
body = body.replace(original_loop, replacement, 1)
io.open(main_c, 'w', encoding='utf-8').write(body)
print('the browser drives the main loop; ASYNCIFY is not needed')

# A latent out-of-bounds the browser catches and a native build does not.
#
# put_pixel_line guards its upper bounds — x + width past 640, y past 256 — and
# not its lower ones. A negative y indexes electron_screen below its start,
# which on a native heap writes into whatever is in front of it and is never
# noticed; WebAssembly traps it. The emulator faults here on the first frame it
# draws, so this is not an edge case reached after hours.
#
# The guard is completed rather than the caller changed: the function already
# decided that an out-of-range line is one to drop and log, and this is the
# same decision applied to the other end of the range.
ula = '/elkulator/src/ula.c'
body = io.open(ula, encoding='utf-8').read()
old_guard = '    if((x + width) > 640 || y >= 256)'
new_guard = '    if(x < 0 || y < 0 || (x + width) > 640 || y >= 256)'
assert old_guard in body, 'put_pixel_line changed shape; the bounds fix needs revisiting'
io.open(ula, 'w', encoding='utf-8').write(body.replace(old_guard, new_guard, 1))
print('put_pixel_line now guards both ends of the range')

# The screen address wraps more than once, and a single subtraction assumed it
# would not.
#
# The ULA computes a video address, and when it runs past the top of memory it
# is brought back by subtracting the mode's screen length. That was written as
# one `if`, which is correct only while the address is at most 0x8000 plus that
# length. It can be higher — mode 6's length is 0x2000, so an address near
# 0xFFFF is still above 0x8000 after one subtraction — and `ram` is 32 KB, so
# the read then lands outside it.
#
# On a native build `ram2` is declared immediately after `ram`, so the read
# quietly returns a neighbouring array and nothing is ever noticed. WebAssembly
# has no such neighbour and traps. A `while` wraps as many times as it takes,
# which is what the hardware does.
ula = '/elkulator/src/ula.c'
body = io.open(ula, encoding='utf-8').read()
old_wrap = """                                if (tempaddr&0x8000)
                                {
                                        tempaddr-=modeInfo[ula.mode].modelens;
                                }"""
new_wrap = """                                while (tempaddr&0x8000)
                                {
                                        tempaddr-=modeInfo[ula.mode].modelens;
                                }"""
assert old_wrap in body, 'the screen-address wrap changed shape; the fix needs revisiting'
io.open(ula, 'w', encoding='utf-8').write(body.replace(old_wrap, new_wrap, 1))
print('screen address now wraps until it is inside memory')

# An unchecked bitmap lock, which is the fault that stopped it running.
#
# Both blit routines call al_lock_bitmap and then dereference the result
# immediately. Allegro is entitled to refuse a lock and return NULL, and under
# the SDL backend it does exactly once — on the very first frame, before the
# bitmap's texture exists. Counting it showed one refusal against a hundred
# successes. The next line reads through that null pointer, which a native
# build turns into a segfault nobody reaches and WebAssembly turns into
# "memory access out of bounds" on the first frame drawn.
#
# A refused lock means there is no frame to draw this time, which is a thing
# the emulator can simply carry on from — so it is reported once and skipped,
# rather than being allowed to take the machine down. Making the surface a
# memory bitmap also stops the refusal, and was tried: it costs two and a half
# times the frame rate, because a memory source drawn to a video target sends
# Allegro down a path that reads the whole backbuffer back every frame. The
# bitmap stays a video bitmap and the one refused lock is simply skipped.
video = '/elkulator/src/host_abstraction_layer/allegro_5/video.c'
body = io.open(video, encoding='utf-8').read()
guard = """    if (!destRegion)
    {
        static int reported;
        if (!reported)
        {
            reported = 1;
            fprintf(stderr, "Bitmap lock refused; frames will not be drawn until it succeeds.\\n");
        }
        return;
    }

    region_data_line = (char *)destRegion->data;"""
old = "    region_data_line = (char *)destRegion->data;"
assert body.count(old) == 2, f'expected two blit routines, found {body.count(old)}'
body = body.replace(old, guard)
if '#include <stdio.h>' not in body:
    body = body.replace('#include', '#include <stdio.h>\n#include', 1)
io.open(video, 'w', encoding='utf-8').write(body)
print('bitmap lock is checked before it is used')

# Frame dropping that drops every frame.
#
# The main loop pauses blitting whenever the accumulated timing error exceeds a
# threshold, which on a native machine sheds the occasional frame to stay in
# sync. In a browser the loop yields to the event loop on every pass, so the
# measured error is always over the threshold and the pause is never lifted
# before the frame is drawn: the emulator runs perfectly and displays nothing.
#
# Under Emscripten the pause is not taken. Frame pacing in a browser is the
# browser's job — requestAnimationFrame already limits how often anything is
# presented — so there is nothing here for this to protect.
ula = '/elkulator/src/ula.c'
body = io.open(ula, encoding='utf-8').read()
old_pause = 'void pause_video_blit()'
new_pause = """void pause_video_blit()
#ifdef __EMSCRIPTEN__
{
    /* See prepare-elkulator.py: in a browser this pause is never lifted in
     * time and every frame is dropped. */
}
static void webide_unused_pause_video_blit()
#endif"""
assert old_pause in body, 'pause_video_blit changed shape; the frame-pacing fix needs revisiting'
io.open(ula, 'w', encoding='utf-8').write(body.replace(old_pause, new_pause, 1))
print('frame pacing left to the browser')

# An absent configuration file is a dead tab rather than a default machine.
#
# `loadconfig` opens `elk.cfg` and closes it unconditionally. Every `get*cfg`
# accessor between the two already returns its default when the handle is NULL —
# so the file being absent is a case the code otherwise handles correctly — but
# the `fclose(NULL)` at the end aborts the WebAssembly instance before the
# emulator has drawn anything. Natively it is undefined behaviour that happens
# to be survivable, so nobody has met it. `saveconfig` closes the same way, and
# is reached from `closeelk` when the machine is stopped.
#
# A page has no home directory to have put a config in, and the IDE supplies the
# machine's configuration itself, so this is the ordinary path here rather than
# an edge case.
config_c = '/elkulator/src/config.c'
body = io.open(config_c, encoding='utf-8').read()
old_close = """        fclose(cfgfile);
}"""
assert body.count(old_close) == 2, f'expected two unguarded fclose calls, found {body.count(old_close)}'
new_close = """        /* An absent config is a defaulted machine, not a crash: every accessor
         * above already answers with its default when this is NULL. */
        if (cfgfile) fclose(cfgfile);
}"""
io.open(config_c, 'w', encoding='utf-8').write(body.replace(old_close, new_close))
print('an absent or unwritable elk.cfg no longer takes the machine down')

# A missing expansion ROM kills the machine.
#
# `loadrom` prints and calls `exit(1)` whenever a file is not there, and
# `loadroms` calls it seven times: the operating system and BASIC, and then the
# Master RAM Board OS, ADFS, DFS, the sound ROM and the Plus 1 support ROM. On a
# desktop those five sit in a `roms` directory beside the binary and are simply
# always present. Here the ROMs are whichever ones the person actually owns and
# has put in the vault, so the ordinary case is that most of them are absent —
# and the machine died on the first one before drawing anything.
#
# The backlog already settled what this build means by an Electron: only the
# operating system and BASIC are required, because an Electron with no Plus 1 is
# a real Electron. So a missing expansion ROM now leaves its bank as the zeroes
# `loadroms` already filled it with, and says which expansion is not there.
mem_c = '/elkulator/src/mem.c'
body = io.open(mem_c, encoding='utf-8').read()
old_loadrom = """/* Loads a rom file into a 16k Buffer*/
void loadrom(uint8_t dest[SIZE_16K], char *name)
{"""
new_loadrom = """/* Loads an expansion rom file into a 16k Buffer, where there is one.
 *
 * An absent expansion is a machine without that expansion rather than a machine
 * that will not start: the bank keeps the zeroes loadroms filled it with, and
 * update_rom_config decides separately whether it is enabled. Only the
 * operating system and BASIC go through loadrom, which still refuses to
 * continue without them. */
void loadrom_optional(uint8_t dest[SIZE_16K], char *name)
{
    FILE *f = fopen(name, "rb");
    if (f == NULL) {
        fprintf(stderr, "No ROM file '%s'; that expansion is not fitted.\\n", name);
        return;
    }
    fread(dest, SIZE_16K, 1, f);
    fclose(f);
}

/* Loads a rom file into a 16k Buffer*/
void loadrom(uint8_t dest[SIZE_16K], char *name)
{"""
assert old_loadrom in body, 'loadrom changed shape; the optional-ROM change needs revisiting'
body = body.replace(old_loadrom, new_loadrom, 1)

old_calls = """        loadrom(os, "os");
        loadrom(mrbos, "os300.rom");
        loadrom(basic, "basic.rom");
        memcpy(rombanks[0xb], basic, SIZE_16K);
        loadrom(adfs, "adfs.rom");
        loadrom(dfs, "dfs.rom");
        loadrom(sndrom, "sndrom");
        loadrom(plus1rom, "plus1.rom");"""
new_calls = """        loadrom(os, "os");
        loadrom_optional(mrbos, "os300.rom");
        loadrom(basic, "basic.rom");
        memcpy(rombanks[0xb], basic, SIZE_16K);
        loadrom_optional(adfs, "adfs.rom");
        loadrom_optional(dfs, "dfs.rom");
        loadrom_optional(sndrom, "sndrom");
        loadrom_optional(plus1rom, "plus1.rom");"""
assert old_calls in body, 'the loadroms call list changed; the optional-ROM change needs revisiting'
io.open(mem_c, 'w', encoding='utf-8').write(body.replace(old_calls, new_calls, 1))
print('a missing expansion ROM is an absent expansion, not a dead machine')
