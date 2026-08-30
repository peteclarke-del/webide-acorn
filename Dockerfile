ARG ARCULATOR_REVISION=579ac437b9a4ebe83b9b5f9b8e50b0c9c530509e

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

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
