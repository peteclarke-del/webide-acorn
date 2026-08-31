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

# The blocking wait is what stops this running in a browser.
#
# `al_wait_for_event` does not return until something arrives, and a page that
# is inside it is a page that never paints. Under Emscripten the same wait is
# expressed as a poll that yields: `emscripten_sleep` hands control back to the
# browser and ASYNCIFY resumes the C stack where it left off, so the loop above
# is unchanged and every local it holds is still valid.
handler = '/elkulator/src/host_abstraction_layer/allegro_5/event_handler.c'
body = io.open(handler, encoding='utf-8').read()
old_wait = '        al_wait_for_event(queue, &event);'
new_wait = """#ifdef __EMSCRIPTEN__
        /* Poll and yield rather than block: see the note in prepare-elkulator.py. */
        while (!al_get_next_event(queue, &event))
        {
            emscripten_sleep(1);
        }
#else
        al_wait_for_event(queue, &event);
#endif"""
assert old_wait in body, 'the blocking wait moved; the browser port needs revisiting'
body = body.replace(old_wait, new_wait, 1)
if '#include <emscripten.h>' not in body:
    body = body.replace('#include', '#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif\n#include', 1)
io.open(handler, 'w', encoding='utf-8').write(body)
print('event_await now yields to the browser')

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
# the SDL backend it does; the next line reads through a null pointer, which
# native builds turn into a segfault nobody reaches and WebAssembly turns into
# "memory access out of bounds" on the first frame drawn.
#
# A refused lock means there is no frame to draw this time, which is a thing
# the emulator can simply carry on from — so it is reported once and skipped,
# rather than being allowed to take the machine down.
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

# The blit bitmap has to be lockable, and a video bitmap is not reliably so.
#
# The HAL asks for ALLEGRO_VIDEO_BITMAP, which puts the surface in GPU texture
# memory. Locking one means reading it back, which Allegro's SDL backend under
# Emscripten declines — and the blit routines lock this bitmap every single
# frame, so the refusal is not an edge case but the normal path. A memory
# bitmap locks unconditionally, which is what a surface written a pixel at a
# time by the CPU should have been in the first place.
#
# Only `b` is changed. The others are drawn to rather than locked, so they keep
# the acceleration they benefit from.
video = '/elkulator/src/host_abstraction_layer/allegro_5/video.c'
body = io.open(video, encoding='utf-8').read()
old_create = '    b = al_create_bitmap(640, 616);'
new_create = """    /* Locked every frame by blit_normal and blit_scanlines, so it must be a
     * memory bitmap: a video bitmap's lock is a texture read-back that the SDL
     * backend refuses. */
    al_set_new_bitmap_flags(ALLEGRO_MEMORY_BITMAP);
    b = al_create_bitmap(640, 616);
    al_set_new_bitmap_flags(ALLEGRO_VIDEO_BITMAP|ALLEGRO_NO_PRESERVE_TEXTURE);"""
assert old_create in body, 'the blit bitmap creation moved; the memory-bitmap fix needs revisiting'
io.open(video, 'w', encoding='utf-8').write(body.replace(old_create, new_create, 1))
print('blit bitmap is now a memory bitmap')

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

# The timer that never ticks, which is why nothing was ever drawn.
#
# The HAL creates a 50 Hz Allegro timer and drives the whole emulator from its
# events: runelk is called when one arrives, and everything else — stepping the
# processor, drawing a frame — follows from that. Allegro's SDL backend on
# Emscripten registers the timer's event source and then never posts to it,
# because there is no thread to tick it from. The emulator therefore initialises
# perfectly, enters its loop, and waits for ever. No error appears because as
# far as the code is concerned nothing has gone wrong.
#
# The tick is supplied here instead, from the clock the browser does have. This
# is a platform service the backend does not implement rather than emulator
# state being invented: the event carries no information beyond "20 ms passed",
# which is precisely what the real timer would have said.
handler = '/elkulator/src/host_abstraction_layer/allegro_5/event_handler.c'
body = io.open(handler, encoding='utf-8').read()
old_poll = """#ifdef __EMSCRIPTEN__
        /* Poll and yield rather than block: see the note in prepare-elkulator.py. */
        while (!al_get_next_event(queue, &event))
        {
            emscripten_sleep(1);
        }
#else"""
new_poll = """#ifdef __EMSCRIPTEN__
        /* Poll and yield rather than block, and supply the 50 Hz tick that
         * Allegro's SDL backend registers a source for and never posts to.
         * See the note in prepare-elkulator.py. */
        {
            static double webide_next_tick_ms = 0;
            while (!al_get_next_event(queue, &event))
            {
                double now_ms = emscripten_get_now();
                if (now_ms >= webide_next_tick_ms)
                {
                    /* Never more than one frame behind: after a long pause,
                     * catching up would run the emulator flat out for as many
                     * frames as elapsed rather than resuming at real speed. */
                    webide_next_tick_ms = now_ms + 20.0;
                    memset(&event, 0, sizeof(event));
                    event.type = ALLEGRO_EVENT_TIMER;
                    break;
                }
                emscripten_sleep(1);
            }
        }
#else"""
assert old_poll in body, 'the Emscripten poll changed shape; the timer fix needs revisiting'
body = body.replace(old_poll, new_poll, 1)
if '#include <string.h>' not in body:
    body = body.replace('#include', '#include <string.h>\n#include', 1)
io.open(handler, 'w', encoding='utf-8').write(body)
print('50 Hz tick supplied from the browser clock')
