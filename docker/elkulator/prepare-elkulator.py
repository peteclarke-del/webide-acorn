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
