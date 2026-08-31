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
