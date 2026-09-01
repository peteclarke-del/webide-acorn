ARG ARCULATOR_REVISION=579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e
ARG ELKULATOR_REVISION=6785521aba2c237861f29d9dee9cfc6725989b1e

FROM emscripten/emsdk:3.1.29@sha256:65920de1d943bdce48a12eca377c801890f113a71c226e075a75ebe4234df081 AS arculator-build
ARG ARCULATOR_REVISION
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git patch xxd \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/pdjstone/arculator-wasm.git /source \
    && git -C /source checkout --detach "${ARCULATOR_REVISION}" \
    && test "$(git -C /source rev-parse HEAD)" = "${ARCULATOR_REVISION}"
COPY docker/arculator/arculator-webide.patch /tmp/arculator-webide.patch
COPY docker/arculator/webide_bridge.c /tmp/webide_bridge.c
RUN sed -i 's/\r$//' /source/src/arc.h /source/src/arm.c /source/src/config.c /source/src/input_sdl2.c /source/src/main.c /source/src/plat_sound.h /source/src/sound_sdl2.c /source/src/emscripten_main.c /source/src/vidc.h /source/src/vidc.c \
    && patch -d /source -p1 --forward < /tmp/arculator-webide.patch \
    && cp /tmp/webide_bridge.c /source/src/webide_bridge.c \
    && make -C /source wasm \
    && test ! -e /source/build/wasm/roms \
    && echo 'c181c7fbbd0f0038f6adf2976a9cd03cb4ad58be3bd32074719fd516d1ddae98  /source/roms/arcrom_ext' | sha256sum -c - \
    && cp /source/roms/arcrom_ext /arculator-support-rom \
    && git -C /source archive --format=tar --prefix="arculator-wasm-${ARCULATOR_REVISION}/" "${ARCULATOR_REVISION}" > /arculator-upstream-source.tar \
    && sha256sum /source/build/wasm/arculator.js /source/build/wasm/arculator.wasm /source/build/wasm/arculator.data /source/build/wasm/arculator.data.js > /arculator-build.sha256

# The second Acorn Electron core.
#
# ElkJS is a 32 KB machine with two ROMs and no per-instruction hook; Elkulator
# is the full Electron with sideways ROM banks, the Plus 1 and Plus 3, and a
# debugger hook the IDE can step and break on. Both ship, and the workbench
# chooses between them by what the person is trying to do.
#
# The recipe, the patch set and the reasoning are in docker/elkulator, and this
# stage runs the same files rather than a second copy of them.
FROM emscripten/emsdk:3.1.29@sha256:65920de1d943bdce48a12eca377c801890f113a71c226e075a75ebe4234df081 AS elkulator-build
ARG ELKULATOR_REVISION
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git autoconf automake libtool pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN embuilder build sdl2 zlib
ARG ALLEGRO_REVISION=5.2.9.1
RUN git clone --depth 1 --branch "${ALLEGRO_REVISION}" https://github.com/liballeg/allegro5.git /allegro5
WORKDIR /allegro5/build
RUN emcmake cmake .. -DCMAKE_BUILD_TYPE=Release \
      -DALLEGRO_SDL=ON -DSHARED=OFF -DWANT_ALLOW_SSE=OFF \
      -DCMAKE_C_FLAGS="-sUSE_SDL=2" \
      -DSDL2_INCLUDE_DIR=/emsdk/upstream/emscripten/cache/sysroot/include/SDL2 \
      -DSDL2_LIBRARY=/emsdk/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/libSDL2.a \
      -DCMAKE_INSTALL_PREFIX=/emsdk/upstream/emscripten/cache/sysroot \
      -DWANT_TESTS=OFF -DWANT_EXAMPLES=OFF -DWANT_DEMO=OFF -DWANT_DOCS=OFF \
      -DWANT_IMAGE=ON -DWANT_PNG=OFF -DWANT_JPG=OFF -DWANT_WEBP=OFF \
      -DWANT_TTF=OFF -DWANT_FONT=ON -DWANT_VIDEO=OFF \
      -DWANT_PHYSFS=OFF -DWANT_NATIVE_DIALOG=OFF \
      -DWANT_AUDIO=ON -DWANT_PRIMITIVES=ON -DWANT_COLOR=ON -DWANT_MEMFILE=ON \
      -DWANT_OPENAL=OFF -DWANT_PULSEAUDIO=OFF -DWANT_ALSA=OFF -DWANT_OSS=OFF \
      > /a5-configure.log 2>&1 && emmake make -j"$(nproc)" > /a5-build.log 2>&1 && make install > /a5-install.log 2>&1
RUN git clone --branch demrepofdave/allegro5_integration https://github.com/demrepofdave/elkulator.git /elkulator \
    && git -C /elkulator checkout --detach "${ELKULATOR_REVISION}" \
    && test "$(git -C /elkulator rev-parse HEAD)" = "${ELKULATOR_REVISION}"
COPY docker/elkulator/webide_alut_shim.h /elkulator/src/webide_alut_shim.h
COPY docker/elkulator/webide_alut_shim.h /elkulator/src/host_abstraction_layer/allegro_5/webide_alut_shim.h
COPY docker/elkulator/allegro_native_dialog_stub.h /emsdk/upstream/emscripten/cache/sysroot/include/allegro5/allegro_native_dialog.h
COPY docker/elkulator/webide_bridge.c /elkulator/src/webide_bridge.c
COPY docker/elkulator/prepare-elkulator.py /tmp/prepare-elkulator.py
RUN python3 /tmp/prepare-elkulator.py
WORKDIR /elkulator
RUN autoreconf -i > /autoreconf.log 2>&1 \
    && emconfigure ./configure --host=wasm32-unknown-emscripten \
      CFLAGS="-sUSE_SDL=2 -sUSE_ZLIB=1 -O2 -I/elkulator/src" \
      LDFLAGS="-sUSE_SDL=2 -sUSE_ZLIB=1 -sFULL_ES2=1 -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"callMain\",\"FS\"] -sEXPORTED_FUNCTIONS=[\"_main\",\"_malloc\",\"_free\"] -sINVOKE_RUN=0 -sFORCE_FILESYSTEM -sMODULARIZE=1 -sEXPORT_NAME=createElkulator" \
      LIBS="-L/emsdk/upstream/emscripten/cache/sysroot/lib -lallegro_image-static -lallegro_font-static -lallegro_audio-static -lallegro_acodec-static -lallegro_primitives-static -lallegro_color-static -lallegro_memfile-static -lallegro-static -lopenal -lSDL2" \
      > /elk-configure.log 2>&1 \
    && emmake make -j"$(nproc)" > /elk-build.log 2>&1 \
    && test -f /elkulator/elkulator.wasm && test -f /elkulator/elkulator \
    && mkdir -p /elkulator-out \
    && cp /elkulator/elkulator.wasm /elkulator-out/elkulator.wasm \
    && cp /elkulator/elkulator /elkulator-out/elkulator.js
# Elkulator's repository carries real Acorn firmware under a note saying it is
# not covered by the GPL, so the corresponding source shipped here excludes it
# and then proves it absent. Firmware in this image is the one thing that must
# never happen, and the check is the proof rather than the intention.
#
# Upstream also has no COPYING file: the README points at one, but it was an
# autotools symlink deleted in commit 54b1bae. The licence text is therefore
# supplied here rather than copied from a fork that does not carry it. The
# source headers settle which licence it is — socket.c and serial.c say GPL
# version 3 or later, and the imported fdi2raw.c says version 2 or later, so
# the work as a whole is GPL-3.0-or-later.
# The tree as it was compiled, patches included, which is what corresponding
# source means. The build products are left out because they are outputs rather
# than source, and .git because a clone is not a distribution.
RUN tar --create --file /elkulator-upstream-source.tar \
      --exclude 'elkulator/roms' --exclude 'elkulator/.git' \
      --exclude '*.o' --exclude '.deps' --exclude 'autom4te.cache' \
      --exclude 'elkulator/elkulator' --exclude 'elkulator/elkulator.wasm' \
      --directory / --transform "s,^elkulator,elkulator-${ELKULATOR_REVISION}," elkulator \
    && test "$(tar --list --file /elkulator-upstream-source.tar | grep -c -iE '/roms/')" = "0" \
    && test "$(tar --list --file /elkulator-upstream-source.tar | grep -c '/\.git/')" = "0" \
    && tar --extract --file /elkulator-upstream-source.tar --to-stdout "elkulator-${ELKULATOR_REVISION}/src/webide_bridge.c" | grep -q elk_webide_before_instruction \
    && sha256sum /elkulator-out/elkulator.js /elkulator-out/elkulator.wasm > /elkulator-build.sha256
# Vendored rather than fetched: a licence the build downloads is a licence the
# build can fail to have, and this one has to travel with the artefact.
COPY docker/elkulator/COPYING-GPL-3.0.txt /elkulator-COPYING.txt
RUN grep -q 'GNU GENERAL PUBLIC LICENSE' /elkulator-COPYING.txt \
    && grep -q 'Version 3' /elkulator-COPYING.txt

FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --no-audit --no-fund

# tsconfig.test.json is copied but never built: Vite resolves the project
# references in tsconfig.json, so a referenced file that is absent fails the
# HTML plugin. The image builds tsconfig.app.json alone, which is why it needs
# no development-only type packages.
COPY index.html emulator.html tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.test.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

# The corresponding source of the two copyleft cores that are conveyed in the
# built output. Arculator already travelled with its exact upstream source, its
# patch and its build hashes; jsbeeb and ElkJS shipped a licence file and
# nothing else, which is an obligation named and not met. Both are taken from
# what was actually installed and vendored for this image, not fetched again, so
# the source shipped is the source built from. `npm run ci` fails if either goes
# missing.
# The core's own ROM directory is excluded and then proved absent. It is not
# part of the source this image is built from — the workbench serves ROMs the
# person running it supplied — and shipping it would put Acorn firmware in the
# image, which is the one thing that must never happen. Archiving the package
# wholesale put 52 ROM files in before this check existed.
RUN tar --create --file /jsbeeb-upstream-source.tar --exclude 'jsbeeb/public/roms' --directory /app/node_modules jsbeeb \
    && tar --create --file /elkjs-upstream-source.tar --directory /app/public/electron elkjs \
    && test "$(tar --list --file /jsbeeb-upstream-source.tar | grep -c -i 'roms/')" = "0" \
    && test "$(tar --list --file /elkjs-upstream-source.tar | grep -c -i 'roms/')" = "0" \
    && sha256sum /jsbeeb-upstream-source.tar /elkjs-upstream-source.tar > /vendored-source.sha256

FROM nginxinc/nginx-unprivileged:1.27.4-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/security-headers-embedded.conf /etc/nginx/snippets/security-headers-embedded.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/node_modules/jsbeeb/COPYING /usr/share/nginx/html/licenses/jsbeeb-COPYING.txt
COPY --from=build /jsbeeb-upstream-source.tar /usr/share/nginx/html/source/jsbeeb-upstream-source.tar
# The Electron slice is served by vendored ElkJS modules, so its GPL-2.0 licence,
# provenance and the one local patch travel with the image as well.
COPY --from=build /app/public/electron/elkjs/LICENSE /usr/share/nginx/html/licenses/elkjs-LICENSE.txt
COPY --from=build /app/public/electron/elkjs/PROVENANCE.md /usr/share/nginx/html/licenses/elkjs-PROVENANCE.md
COPY docker/elkjs/elkjs-webide.patch /usr/share/nginx/html/licenses/elkjs-webide.patch
COPY --from=build /elkjs-upstream-source.tar /usr/share/nginx/html/source/elkjs-upstream-source.tar
COPY --from=build /vendored-source.sha256 /usr/share/nginx/html/source/vendored-source.sha256
COPY --from=arculator-build /source/build/wasm/arculator.js /source/build/wasm/arculator.wasm /source/build/wasm/arculator.data /source/build/wasm/arculator.data.js /usr/share/nginx/html/arculator/
COPY --from=arculator-build /arculator-support-rom /usr/share/nginx/html/arculator/arcrom_ext
COPY --from=arculator-build /source/COPYING /usr/share/nginx/html/licenses/arculator-wasm-COPYING.txt
COPY --from=arculator-build /arculator-upstream-source.tar /usr/share/nginx/html/source/arculator-upstream-source.tar
COPY --from=arculator-build /arculator-build.sha256 /usr/share/nginx/html/source/arculator-build.sha256
COPY docker/arculator/arculator-webide.patch docker/arculator/webide_bridge.c /usr/share/nginx/html/source/arculator-webide/
COPY --from=elkulator-build /elkulator-out/elkulator.js /elkulator-out/elkulator.wasm /usr/share/nginx/html/elkulator/
COPY --from=elkulator-build /elkulator-COPYING.txt /usr/share/nginx/html/licenses/elkulator-COPYING.txt
COPY --from=elkulator-build /elkulator-upstream-source.tar /usr/share/nginx/html/source/elkulator-upstream-source.tar
COPY --from=elkulator-build /elkulator-build.sha256 /usr/share/nginx/html/source/elkulator-build.sha256
COPY docker/elkulator/prepare-elkulator.py docker/elkulator/webide_bridge.c docker/elkulator/webide_alut_shim.h docker/elkulator/allegro_native_dialog_stub.h docker/elkulator/PROVENANCE.md /usr/share/nginx/html/source/elkulator-webide/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
