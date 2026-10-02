# Janus WebRTC Gateway v1.4.2, built from the official release tarball.
# Why from source: no official Meetecho image exists and the community images
# are stale (canyan: 2024) or untagged sidecar builds. Single-stage on purpose —
# a dev image where the runtime package names (the Ubuntu 24.04 "t64" rename
# roulette) are not worth a second stage; size is acceptable for a dev stack.
#
# Compiled in: WebSocket transport (8188) + HTTP API transport (8088) +
# AudioBridge plugin (Opus MCU) + post-processing. Sample configs are installed
# to /opt/janus/etc/janus by `make configs`; docker-compose mounts two overrides
# over the stock files (whole-file replacement).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential autoconf automake libtool pkg-config \
        ca-certificates curl \
        libglib2.0-dev libconfig-dev zlib1g-dev \
        libjansson-dev libnice-dev libssl-dev libsrtp2-dev libcurl4-openssl-dev \
        libwebsockets-dev libmicrohttpd-dev libopus-dev libogg-dev gengetopt \
    && rm -rf /var/lib/apt/lists/*

ARG JANUS_VERSION=1.4.2
RUN curl -fsSL "https://github.com/meetecho/janus-gateway/archive/refs/tags/v${JANUS_VERSION}.tar.gz" \
        | tar xz -C /tmp \
    && cd "/tmp/janus-gateway-${JANUS_VERSION}" \
    && ./autogen.sh \
    && ./configure --prefix=/opt/janus \
    && make -j"$(nproc)" \
    && make install \
    && make configs \
    && rm -rf /tmp/janus-gateway-* \
    && apt-get purge -y autoconf automake libtool gengetopt \
    && apt-get autoremove -y

EXPOSE 8188 8088 51000-51100/udp

ENTRYPOINT ["/opt/janus/bin/janus"]
CMD ["-F", "/opt/janus/etc/janus"]
