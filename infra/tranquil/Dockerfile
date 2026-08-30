ARG DISTROLESS_IMAGE=gcr.io/distroless/cc-debian13:latest@sha256:1e3c6d9c255be500eb680cdea0ad07554f52ae92dfcbdf07043a2a435b4c1fe3

FROM node:24-trixie-slim AS frontend
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate
WORKDIR /app
COPY vendor/frontend/package.json vendor/frontend/pnpm-lock.yaml vendor/frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY vendor/frontend/ ./
RUN pnpm build

FROM rust:1.96-slim-trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates pkg-config libssl-dev mold clang protobuf-compiler && rm -rf /var/lib/apt/lists/*
ENV RUSTFLAGS="-C linker=clang -C link-arg=-fuse-ld=mold"
WORKDIR /app
COPY vendor/Cargo.toml vendor/Cargo.lock ./
COPY vendor/.sqlx ./.sqlx
COPY vendor/crates ./crates
COPY vendor/migrations ./migrations
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=tranquil-target,target=/app/target,sharing=locked \
    SQLX_OFFLINE=true cargo build --release -p tranquil-server && \
    cp target/release/tranquil-server /tmp/tranquil-pds

FROM ${DISTROLESS_IMAGE}
COPY --from=builder /tmp/tranquil-pds /usr/local/bin/tranquil-pds
COPY --from=frontend --chown=65532:65532 /app/dist /var/lib/tranquil-pds/frontend
WORKDIR /var/lib/tranquil-pds
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=10000
EXPOSE 10000
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/tranquil-pds"]
