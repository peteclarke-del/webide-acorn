FROM composer:2.9.3 AS vendor

WORKDIR /app
COPY backend/composer.json backend/composer.lock ./
COPY backend/src ./src
RUN composer install --no-dev --classmap-authoritative --no-interaction --no-progress --no-scripts

FROM debian:bookworm-slim AS beebasm-build

ARG BEEBASM_COMMIT=ca2cc5fd2fa3f73da3b0682ad004b2aca99840c3
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git g++ make \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/stardot/beebasm.git /source \
    && git -C /source checkout --detach "${BEEBASM_COMMIT}" \
    && test "$(git -C /source rev-parse HEAD)" = "${BEEBASM_COMMIT}" \
    && make -C /source/src code CXXFLAGS='-O3 -pedantic -DNDEBUG -Wall -W -Wcast-qual -Werror -Wshadow -Wcast-align -Wold-style-cast -Woverloaded-virtual -Wno-array-bounds -Wno-error=use-after-free' \
    && git -C /source archive --format=tar --prefix=beebasm-${BEEBASM_COMMIT}/ "${BEEBASM_COMMIT}" > /beebasm-source.tar

FROM php:8.3.25-fpm-bookworm AS runtime

ARG CC65_PACKAGE_VERSION=2.19-1
ARG ARM_BINUTILS_PACKAGE_VERSION=2.40-2+18+b1
RUN apt-get update \
    && apt-get install --yes --no-install-recommends "cc65=${CC65_PACKAGE_VERSION}" "binutils-arm-none-eabi=${ARM_BINUTILS_PACKAGE_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && ca65 --version \
    && ld65 --version

ENV ARM_BINUTILS_PACKAGE_VERSION=${ARM_BINUTILS_PACKAGE_VERSION}

WORKDIR /app
COPY backend/config ./config
COPY backend/public ./public
COPY backend/src ./src
COPY backend/bin ./bin
COPY backend/composer.json backend/composer.lock ./
COPY --from=vendor /app/vendor ./vendor
COPY --from=beebasm-build /source/beebasm /usr/local/bin/beebasm
COPY --from=beebasm-build /source/COPYING.txt /usr/share/licenses/beebasm/COPYING.txt
COPY --from=beebasm-build /beebasm-source.tar /usr/share/source/beebasm-source.tar
COPY backend/resources/cc65-bbc /usr/local/share/8bit-net/cc65-bbc
COPY backend/docker/php-fpm.conf /usr/local/etc/php-fpm.conf

RUN mkdir -p /usr/local/lib/8bit-net/cc65-bbc \
    && ca65 --target bbc --cpu 6502 --debug-info -o /usr/local/lib/8bit-net/cc65-bbc/crt0.o /usr/local/share/8bit-net/cc65-bbc/crt0.s \
    && ca65 --target bbc --cpu 6502 --debug-info -o /usr/local/lib/8bit-net/cc65-bbc/platform.o /usr/local/share/8bit-net/cc65-bbc/platform.s \
    && sha256sum /usr/local/lib/8bit-net/cc65-bbc/crt0.o /usr/local/lib/8bit-net/cc65-bbc/platform.o /usr/share/cc65/lib/none.lib > /usr/local/share/8bit-net/cc65-bbc/runtime.sha256 \
    && mkdir -p /run/php /tmp/native-builds \
    && chown -R www-data:www-data /run/php /tmp/native-builds \
    && chmod 0755 bin/console \
    && php bin/console cache:warmup --env=prod \
    && chown -R www-data:www-data var

USER www-data:www-data

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD php /app/bin/console about --env=prod >/dev/null && /usr/bin/cc65 --version >/dev/null && /usr/bin/ca65 --version >/dev/null && /usr/bin/ld65 --version >/dev/null && /usr/bin/arm-none-eabi-as --version >/dev/null && /usr/bin/arm-none-eabi-ld --version >/dev/null && /usr/bin/arm-none-eabi-objcopy --version >/dev/null && test -r /usr/local/lib/8bit-net/cc65-bbc/crt0.o && test -r /usr/local/lib/8bit-net/cc65-bbc/platform.o && /usr/local/bin/beebasm --help >/dev/null || exit 1

CMD ["php-fpm", "--nodaemonize", "--fpm-config", "/usr/local/etc/php-fpm.conf"]
